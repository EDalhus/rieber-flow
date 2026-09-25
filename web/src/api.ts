import { useCallback, useEffect, useState } from 'react';

export type ProduktType = 'Bulk' | 'Bigbag' | 'Pall';
export type Produkt = {
  id: number; produktnr: string; navn: string; beskrivelse: string; type: ProduktType; enhet: string; kg_per_enhet: number;
  fargekode: string; lager: number; aktiv: number; antall_linjer?: number;
};
export const TYPE_NAVN: Record<ProduktType, string> = { Bulk: 'Bulk', Bigbag: 'Bigbags', Pall: 'Pallevarer' };
/** Mengde med riktig enhet for produkttypen (tonn / bigbags / paller). */
export const mengdeTekst = (type: ProduktType, n: number) => {
  const t = String(Math.round(n * 10) / 10).replace('.', ',');
  return type === 'Bulk' ? `${t} t` : type === 'Bigbag' ? `${t} bigbags` : `${t} paller`;
};
export type Bat = {
  id: number; skipsnavn: string; mmsi: string | null; eta: string;
  status: 'Ventet' | 'Ankommet' | 'Lasting' | 'Ferdig';
  tonn_totalt: number; tonn_lastet: number; antall_steg: number;
};
export type Linje = {
  id: number; so_id: number; produkt_id?: number; produktnr?: string; produkt: string; salttype: string; fargekode: string;
  emballasje: 'Bulk' | 'Bigbag' | 'Pall'; antall: number; enhet: string; kg_per_enhet: number;
};
export type SO = {
  linjer?: Linje[];
  id: number; ordrenummer: string; kunde: string; salttype: string; tonn: number;
  frist: string; status: string; batanlop_id: number | null; fargekode: string;
};
export type Steg = {
  linjer?: Linje[];
  steg_id: number; batanlop_id: number; so_id: number; rekkefolge_nummer: number;
  steg_status: 'Venter' | 'Aktiv' | 'Ferdig'; ordrenummer: string; kunde: string;
  salttype: string; tonn: number; frist: string; fargekode: string;
};
export type Dashboard = {
  varer: Produkt[];
  totalt: { tonn_bulk: number; antall_bigbags: number; antall_paller: number };
  perioder: { dager: number; bigbags: number; salgTonn: number }[];
  produksjonPerDag: { dato: string; bigbags: number }[];
};
export type Bruker = { id: number; epost: string; navn: string; rolle: string };
export type Meg = { bruker: Bruker; demo: boolean; brukere: Bruker[] };

export const demoBruker = () => {
  try { return localStorage.getItem('flow-user'); } catch { return null; }
};

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  const demo = demoBruker();
  if (demo) headers['X-Demo-User'] = demo; // kun demo – ekte innlogging kommer via Cloudflare Access
  const r = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as any)?.error ?? r.statusText);
  return r.json();
}

/** Henter data og poller jevnlig, slik at kontoret ser sjåførens fremdrift live. */
export function useApi<T>(path: string, pollMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  return { data, error, reload, setData };
}

export const fmtTonn = (n: number) => `${Math.round(n * 10) / 10 } t`.replace('.', ',');
export const fmtDato = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function fristTekst(iso: string) {
  const t = (new Date(iso).getTime() - Date.now()) / 3600000;
  if (t < 0) return { tekst: `${Math.round(-t)} t over frist`, haster: true };
  if (t < 24) return { tekst: `om ${Math.max(1, Math.round(t))} t`, haster: t < 12 };
  return { tekst: `om ${Math.round(t / 24)} d`, haster: false };
}

/** Svart eller hvit tekst avhengig av bakgrunnsfargen. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 150 ? '#111' : '#fff';
}

export type Posisjon = {
  mmsi: string; imo?: string | null; navn: string | null; lat: number; lon: number; sog: number | null; cog: number | null; heading: number | null;
  destinasjon: string | null; eta: string | null; msgtime: string | null;
  navstatus?: number | null; stevning?: number | null; rot?: number | null;
  skipstype?: number | null; kallesignal?: string | null; lengde?: number | null; bredde?: number | null; dypgang?: number | null; flagg?: string | null;
};
export type FartoyInfo = {
  rederi: string; kaptein_navn: string; kaptein_tlf: string; chief_navn: string; chief_tlf: string; epost: string;
  agent_navn: string; agent_tlf: string; vhf_kanal: string; kapasitet: string; bilde_url: string; notater: string;
  oppdatert: string; oppdatert_av_navn: string | null;
};
export type FartoyBilde = { id: number; hoved: number };
export type FlateFartoy = { mmsi: string; navn: string; posisjon: Posisjon | null; gjest?: boolean };
export type FlateSvar = { kilde: 'ais' | 'ingen'; feil: string | null; fartoy: FlateFartoy[] };

export type Vurdering = 'Bra' | 'Merknad' | 'Avvik' | 'Ikke vurdert';
export type Foering = {
  id: number; batanlop_id: number | null; baatnavn: string; mmsi: string | null; kai_dato: string;
  operasjon: 'Lasting' | 'Lossing'; varetype: 'Bulk' | 'Pallevarer' | 'Begge'; tonn: number | null;
  vurdering: Vurdering; tilbakemelding: string; antall_bilder?: number; antall_anlop?: number;
  opprettet_av_navn?: string | null; bilder?: { id: number; filnavn: string; storrelse: number }[];
};
export type KaibokBaat = { baatnavn: string; antall: number; siste: string; forste: string; avvik: number };

export const KATEGORIER = ['Lege/tannlege', 'Verksted/bil', 'Skole/barn', 'Ferie', 'Sykdom', 'Annet', 'Ikke overtid'] as const;
export type Fravaer = {
  id: number; bruker_id: number; navn: string; rolle: string; kategori: (typeof KATEGORIER)[number]; tittel: string;
  dato_fra: string; dato_til: string; tid_fra: string | null; tid_til: string | null; ikke_overtid: number;
};
export type KalAnlop = { type: 'anlop' | 'kaibok'; id: number; navn: string; dato: string; tid: string | null; status: string; href: string; varetype?: string; vurdering?: string };
export type KalenderSvar = { anlop: KalAnlop[]; fravaer: Fravaer[]; antallAnsatte: number; meg: number };

export const pad2 = (n: number) => String(n).padStart(2, '0');
/** Lokal dato som YYYY-MM-DD. */
export const dagStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const fmtDag = (iso: string, lang: 'kort' | 'lang' = 'kort') =>
  new Date(iso + 'T12:00:00').toLocaleDateString('nb-NO', lang === 'kort' ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long' });
