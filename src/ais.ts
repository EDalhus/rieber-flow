// Barentswatch AIS (Kystverkets åpne AIS-data). Dokumentasjon: https://developer.barentswatch.no/docs/AIS/live-ais-api
// Uten BARENTSWATCH_CLIENT_ID/SECRET faller vi tilbake til simulerte posisjoner (src/mock.ts).
import { KATALOG, mockSiste, mockSpor } from './mock';

export type AisEnv = { BARENTSWATCH_CLIENT_ID?: string; BARENTSWATCH_CLIENT_SECRET?: string };

export type Pos = {
  mmsi: string; imo: string | null; navn: string | null; lat: number; lon: number;
  sog: number | null; cog: number | null; heading: number | null;
  navstatus: number | null; skipstype: number | null;
  destinasjon: string | null; eta: string | null; msgtime: string | null;
  stevning?: number | null; rot?: number | null;
  kallesignal?: string | null; lengde?: number | null; bredde?: number | null; dypgang?: number | null; flagg?: string | null;
};
export type Fartoy = { mmsi: string; imo: string | null; navn: string; skipstype: number | null };

const LIVE = 'https://live.ais.barentswatch.no';
const HISTORIC = 'https://historic.ais.barentswatch.no';

export const harNokkel = (env: AisEnv) => !!(env.BARENTSWATCH_CLIENT_ID && env.BARENTSWATCH_CLIENT_SECRET);
export const kilde = (env: AisEnv) => (harNokkel(env) ? 'ais' : 'simulert');

let token: { verdi: string; utloper: number } | null = null;

async function hentToken(env: AisEnv): Promise<string> {
  if (token && token.utloper > Date.now() + 60_000) return token.verdi;
  const r = await fetch('https://id.barentswatch.no/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.BARENTSWATCH_CLIENT_ID!.trim(), client_secret: env.BARENTSWATCH_CLIENT_SECRET!.trim(),
      scope: 'ais', grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) {
    const svar = (await r.json().catch(() => null)) as { error?: string; error_description?: string } | null;
    throw new Error(`Barentswatch-innlogging feilet (${r.status}${svar?.error ? `: ${svar.error}` : ''}${svar?.error_description ? ` – ${svar.error_description}` : ''})`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  token = { verdi: j.access_token, utloper: Date.now() + j.expires_in * 1000 };
  return token.verdi;
}

async function bw(env: AisEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await hentToken(env)}` } });
  if (r.status === 401) token = null;
  return r;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Tåler både flat JSON og GeoJSON-Feature fra Barentswatch. */
function tilPos(raw: any): Pos | null {
  const r = raw?.properties ? { ...raw.properties, geometry: raw.geometry } : raw;
  const lat = num(r?.latitude) ?? num(r?.geometry?.coordinates?.[1]);
  const lon = num(r?.longitude) ?? num(r?.geometry?.coordinates?.[0]);
  if (lat == null || lon == null || r?.mmsi == null) return null;
  const heading = num(r.trueHeading);
  return {
    mmsi: String(r.mmsi), imo: r.imoNumber ? String(r.imoNumber) : null, navn: r.name?.trim() || null, lat, lon,
    sog: num(r.speedOverGround), cog: num(r.courseOverGround),
    heading: heading != null && heading < 360 ? heading : num(r.courseOverGround),
    navstatus: num(r.navigationalStatus), skipstype: num(r.shipType),
    destinasjon: r.destination?.trim() || null, eta: r.eta ?? null, msgtime: r.msgtime ?? null,
    stevning: heading != null && heading < 360 ? heading : null, rot: num(r.rateOfTurn),
    kallesignal: r.callSign?.trim() || null, lengde: num(r.shipLength), bredde: num(r.shipWidth), dypgang: num(r.draught), flagg: r.countryCode ?? null,
  };
}

/** Siste kjente posisjon for et lite sett MMSI-er (flåten). */
export async function sistePosisjoner(env: AisEnv, mmsi: string[]): Promise<Map<string, Pos>> {
  const ut = new Map<string, Pos>();
  if (mmsi.length === 0) return ut;
  if (!harNokkel(env)) {
    for (const m of mmsi) { const p = mockSiste(m); if (p) ut.set(m, p); }
    return ut;
  }
  const body = JSON.stringify({ mmsi: mmsi.map(Number) });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
  // «Full» gir destinasjon/ETA; faller tilbake til standardmodellen hvis den avvises
  let r = await bw(env, `${LIVE}/v1/latest/combined?modelType=Full`, opts);
  if (!r.ok) r = await bw(env, `${LIVE}/v1/latest/combined`, opts);
  if (!r.ok) throw new Error(`Barentswatch AIS feilet (${r.status})`);
  for (const raw of (await r.json()) as any[]) {
    const p = tilPos(raw);
    if (p) ut.set(p.mmsi, p);
  }
  return ut;
}

/** Alle fartøy med nylig posisjon (stor liste – caches i 10 min). «Full»-modellen har IMO-nummer. */
async function alleFartoy(env: AisEnv, cache: Cache): Promise<Fartoy[]> {
  if (!harNokkel(env)) return KATALOG.map((k) => ({ mmsi: k.mmsi, imo: k.imo, navn: k.navn, skipstype: k.skipstype }));
  const nokkel = new Request('https://cache.rieber-flow.internal/ais-alle-v2');
  const treff = await cache.match(nokkel);
  if (treff) return (await treff.json()) as Fartoy[];
  let r = await bw(env, `${LIVE}/v1/latest/combined?modelType=Full`);
  if (!r.ok) r = await bw(env, `${LIVE}/v1/latest/combined`);
  if (!r.ok) throw new Error(`Barentswatch AIS feilet (${r.status})`);
  const liste = ((await r.json()) as any[]).flatMap((raw) => {
    const p = tilPos(raw);
    return p ? [{ mmsi: p.mmsi, imo: p.imo, navn: p.navn ?? '', skipstype: p.skipstype }] : [];
  });
  await cache.put(nokkel, new Response(JSON.stringify(liste), { headers: { 'Cache-Control': 'max-age=600', 'Content-Type': 'application/json' } }));
  return liste;
}

/** Søk på skipsnavn (alle ord), IMO-nummer (7 siffer, evt. «IMO 1234567») eller MMSI (9 siffer). */
export async function sokFartoy(env: AisEnv, q: string, cache: Cache): Promise<Fartoy[]> {
  const t = q.trim().toLowerCase().replace(/^imo[\s:]*/, '').replace(/\s+/g, ' ');
  if (t.length < 2) return [];
  const siffer = /^\d+$/.test(t);
  const ord = t.split(' ');
  const liste = await alleFartoy(env, cache);

  const poeng = (f: Fartoy): number => {
    const navn = f.navn.toLowerCase();
    if (siffer) {
      if (f.imo === t || f.mmsi === t) return 100;
      if (f.imo?.startsWith(t) || f.mmsi.startsWith(t)) return 50;
      return 0;
    }
    if (navn === t) return 100;
    if (navn.startsWith(t)) return 80;
    if (ord.every((o) => navn.includes(o))) return 50;
    return 0;
  };
  const treff = liste.map((f) => ({ f, p: poeng(f) })).filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.f.navn.localeCompare(b.f.navn)).slice(0, 20).map((x) => x.f);

  // Nøyaktig MMSI som ikke ligger i listen: slå opp direkte (fartøyet kan ha nylig posisjon likevel)
  if (harNokkel(env) && /^\d{9}$/.test(t) && !treff.some((f) => f.mmsi === t)) {
    const p = (await sistePosisjoner(env, [t]).catch(() => new Map<string, Pos>())).get(t);
    if (p) treff.unshift({ mmsi: p.mmsi, imo: p.imo, navn: p.navn ?? `MMSI ${p.mmsi}`, skipstype: p.skipstype });
  }
  return treff;
}

/** Siste 24 timers spor. */
export async function spor(env: AisEnv, mmsi: string) {
  if (!harNokkel(env)) return mockSpor(mmsi);
  const r = await bw(env, `${HISTORIC}/v1/historic/trackslast24hours/${encodeURIComponent(mmsi)}`);
  if (!r.ok) return [];
  return ((await r.json()) as any[]).flatMap((raw) => {
    const p = tilPos(raw);
    return p ? [{ lat: p.lat, lon: p.lon, msgtime: p.msgtime }] : [];
  });
}

/** Feilsøking av AIS-oppsettet. Returnerer aldri verdier på hemmelighetene – bare status og feltnavn. */
export async function diagnose(env: AisEnv) {
  const ut: Record<string, unknown> = {
    clientId: !!env.BARENTSWATCH_CLIENT_ID,
    clientSecret: !!env.BARENTSWATCH_CLIENT_SECRET,
  };
  if (!harNokkel(env)) {
    ut.konklusjon = 'Nøklene er ikke tilgjengelige for Worker-en ved kjøring. Legg dem inn som «Variables and Secrets» på selve Worker-en (Settings), ikke som build-variabler, og deploy på nytt.';
    return ut;
  }
  try {
    token = null;
    await hentToken(env);
    ut.token = 'ok';
  } catch (e) {
    ut.token = (e as Error).message;
    ut.konklusjon = 'Innloggingen mot Barentswatch feilet. Sjekk at klienten er registrert som AIS-client og at id/secret er riktig (ingen mellomrom).';
    return ut;
  }
  const r = await bw(env, `${LIVE}/v1/latest/combined`);
  ut.latestStatus = r.status;
  if (r.ok) {
    const liste = (await r.json()) as any[];
    ut.antallFartoy = liste.length;
    ut.feltnavn = liste[0] ? Object.keys(liste[0]) : [];
    ut.konklusjon = 'AIS fungerer. Fartøy i flåten uten posisjon har trolig feil MMSI eller ingen nylig AIS-melding.';
  } else {
    ut.konklusjon = `Barentswatch svarte ${r.status}. Klienten mangler trolig tilgang til AIS-scope.`;
  }
  return ut;
}
