// Barentswatch AIS (Kystverkets åpne AIS-data). Dokumentasjon: https://developer.barentswatch.no/docs/AIS/live-ais-api
// Uten BARENTSWATCH_CLIENT_ID/SECRET faller vi tilbake til simulerte posisjoner (src/mock.ts).
import { KATALOG, mockSiste, mockSpor } from './mock';

export type AisEnv = { BARENTSWATCH_CLIENT_ID?: string; BARENTSWATCH_CLIENT_SECRET?: string };

export type Pos = {
  mmsi: string; navn: string | null; lat: number; lon: number;
  sog: number | null; cog: number | null; heading: number | null;
  navstatus: number | null; skipstype: number | null;
  destinasjon: string | null; eta: string | null; msgtime: string | null;
};
export type Fartoy = { mmsi: string; navn: string; skipstype: number | null };

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
      client_id: env.BARENTSWATCH_CLIENT_ID!, client_secret: env.BARENTSWATCH_CLIENT_SECRET!,
      scope: 'ais', grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) throw new Error(`Barentswatch-innlogging feilet (${r.status})`);
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
    mmsi: String(r.mmsi), navn: r.name?.trim() || null, lat, lon,
    sog: num(r.speedOverGround), cog: num(r.courseOverGround),
    heading: heading != null && heading < 360 ? heading : num(r.courseOverGround),
    navstatus: num(r.navigationalStatus), skipstype: num(r.shipType),
    destinasjon: r.destination?.trim() || null, eta: r.eta ?? null, msgtime: r.msgtime ?? null,
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

/** Søk i alle fartøy med nylig posisjon (listen caches i 10 min – den er stor). */
export async function sokFartoy(env: AisEnv, q: string, cache: Cache): Promise<Fartoy[]> {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  let liste: Fartoy[];
  if (!harNokkel(env)) {
    liste = KATALOG.map((k) => ({ mmsi: k.mmsi, navn: k.navn, skipstype: k.skipstype }));
  } else {
    const nokkel = new Request('https://cache.rieber-flow.internal/ais-alle');
    const treff = await cache.match(nokkel);
    if (treff) liste = (await treff.json()) as Fartoy[];
    else {
      const r = await bw(env, `${LIVE}/v1/latest/combined`);
      if (!r.ok) throw new Error(`Barentswatch AIS feilet (${r.status})`);
      liste = ((await r.json()) as any[]).flatMap((raw) => {
        const p = tilPos(raw);
        return p && p.navn ? [{ mmsi: p.mmsi, navn: p.navn, skipstype: p.skipstype }] : [];
      });
      await cache.put(nokkel, new Response(JSON.stringify(liste), { headers: { 'Cache-Control': 'max-age=600', 'Content-Type': 'application/json' } }));
    }
  }
  return liste.filter((f) => f.navn.toLowerCase().includes(t) || f.mmsi.startsWith(t)).slice(0, 20);
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
