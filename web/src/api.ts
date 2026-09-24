import { useCallback, useEffect, useState } from 'react';

export type Salt = { id: number; salttype: string; fargekode: string; tonn_bulk: number; antall_bigbags: number };
export type Bat = {
  id: number; skipsnavn: string; mmsi: string | null; eta: string;
  status: 'Ventet' | 'Ankommet' | 'Lasting' | 'Ferdig';
  tonn_totalt: number; tonn_lastet: number; antall_steg: number;
};
export type Linje = {
  id: number; so_id: number; produkt: string; salttype: string; fargekode: string;
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
  varer: Salt[];
  totalt: { tonn_bulk: number; antall_bigbags: number };
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
};
export type FlateFartoy = { mmsi: string; navn: string; posisjon: Posisjon | null };
export type FlateSvar = { kilde: 'ais' | 'simulert'; feil: string | null; fartoy: FlateFartoy[] };
