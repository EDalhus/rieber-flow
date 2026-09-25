import type { Hono } from 'hono';
import type { Env } from './types';
import { hentBruker } from './bruker';
import { sokFartoy } from './ais';

export type SokTreff = { kategori: string; id: string; tittel: string; sub: string; href: string };

const esc = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const dato = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' });

/** Globalt søk (⌘K) på tvers av alle sider, gruppert i kategorier. */
export function sokRoutes(app: Hono<Env>) {
  app.get('/api/sok', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 80);
    if (q.length < 2) return c.json([]);
    const p = esc(q);
    const db = c.env.DB;
    const { bruker } = await hentBruker(c);

    const [bat, so, kai, flate, info, frv, brk, minFlate, ais, prod] = await Promise.all([
      db.prepare(`SELECT id, skipsnavn, eta, status FROM Batanlop WHERE skipsnavn LIKE ?1 ESCAPE '\\' OR mmsi LIKE ?1 ESCAPE '\\' ORDER BY eta DESC LIMIT 5`).bind(p).all<any>(),
      db.prepare(
        `SELECT DISTINCT s.id, s.ordrenummer, s.kunde, s.tonn, s.status, s.batanlop_id, s.frist FROM Salgsordrer s
         LEFT JOIN SalgsordreLinjer l ON l.so_id = s.id LEFT JOIN Produkter pr ON pr.id = l.produkt_id
         WHERE s.ordrenummer LIKE ?1 ESCAPE '\\' OR s.kunde LIKE ?1 ESCAPE '\\' OR pr.navn LIKE ?1 ESCAPE '\\' OR pr.produktnr LIKE ?1 ESCAPE '\\'
         ORDER BY s.frist LIMIT 6`,
      ).bind(p).all<any>(),
      db.prepare(
        `SELECT id, baatnavn, kai_dato, operasjon, vurdering, tilbakemelding FROM Kaibok
         WHERE baatnavn LIKE ?1 ESCAPE '\\' OR tilbakemelding LIKE ?1 ESCAPE '\\' ORDER BY kai_dato DESC LIMIT 5`,
      ).bind(p).all<any>(),
      db.prepare(`SELECT mmsi, navn FROM Flate WHERE bruker_id = ?2 AND (navn LIKE ?1 ESCAPE '\\' OR mmsi LIKE ?1 ESCAPE '\\') LIMIT 5`).bind(p, bruker.id).all<any>(),
      db.prepare(
        `SELECT i.mmsi, i.rederi, i.kaptein_navn, i.kaptein_tlf, i.chief_navn, i.agent_navn, i.epost,
                COALESCE((SELECT navn FROM Flate WHERE mmsi = i.mmsi LIMIT 1), 'MMSI ' || i.mmsi) AS navn
         FROM FartoyInfo i
         WHERE i.rederi LIKE ?1 ESCAPE '\\' OR i.kaptein_navn LIKE ?1 ESCAPE '\\' OR i.chief_navn LIKE ?1 ESCAPE '\\'
            OR i.agent_navn LIKE ?1 ESCAPE '\\' OR i.epost LIKE ?1 ESCAPE '\\' OR i.notater LIKE ?1 ESCAPE '\\' LIMIT 5`,
      ).bind(p).all<any>(),
      db.prepare(
        `SELECT f.id, f.kategori, f.tittel, f.dato_fra, f.dato_til, f.tid_fra, f.tid_til, b.navn FROM Fravaer f JOIN Brukere b ON b.id = f.bruker_id
         WHERE f.dato_til >= date('now', '-30 days') AND (b.navn LIKE ?1 ESCAPE '\\' OR f.tittel LIKE ?1 ESCAPE '\\' OR f.kategori LIKE ?1 ESCAPE '\\')
         ORDER BY f.dato_fra LIMIT 6`,
      ).bind(p).all<any>(),
      db.prepare(`SELECT id, navn, rolle, epost FROM Brukere WHERE navn LIKE ?1 ESCAPE '\\' OR rolle LIKE ?1 ESCAPE '\\' OR epost LIKE ?1 ESCAPE '\\' LIMIT 4`).bind(p).all<any>(),
      db.prepare('SELECT mmsi FROM Flate WHERE bruker_id = ?').bind(bruker.id).all<{ mmsi: string }>(),
      // Alle fartøy i AIS (Kystverket/Barentswatch) – feil her skal aldri ødelegge resten av søket
      sokFartoy(c.env, q, caches.default).catch(() => []),
      db.prepare(`SELECT id, produktnr, navn, type, beskrivelse FROM Produkter WHERE aktiv = 1 AND (navn LIKE ?1 ESCAPE '\\' OR produktnr LIKE ?1 ESCAPE '\\' OR beskrivelse LIKE ?1 ESCAPE '\\') LIMIT 5`).bind(p).all<any>(),
    ]);
    const iFlate = new Set(minFlate.results.map((f) => f.mmsi));

    const ut: SokTreff[] = [
      ...bat.results.map((b) => ({ kategori: 'Båtanløp', id: `bat${b.id}`, tittel: b.skipsnavn, sub: `ETA ${dato(b.eta)} · ${b.status}`, href: `#/anlop/${b.id}` })),
      ...so.results.map((s) => ({
        kategori: 'Salgsordrer', id: `so${s.id}`, tittel: `${s.ordrenummer} · ${s.kunde}`,
        sub: `${s.tonn} t · ${s.status}${s.batanlop_id ? ' · på båt' : ''}`, href: s.batanlop_id ? `#/anlop/${s.batanlop_id}` : '#/so-ko',
      })),
      ...kai.results.map((k) => ({
        kategori: 'Kaibok', id: `kai${k.id}`, tittel: `${k.baatnavn} · ${dato(k.kai_dato)}`,
        sub: `${k.operasjon} · ${k.vurdering}${k.tilbakemelding ? ` – ${k.tilbakemelding.slice(0, 70)}` : ''}`, href: `#/kaibok?id=${k.id}`,
      })),
      ...flate.results.map((f) => ({ kategori: 'Flåte & båtinfo', id: `fl${f.mmsi}`, tittel: f.navn, sub: `MMSI ${f.mmsi} · i flåten din`, href: `#/flate?mmsi=${f.mmsi}` })),
      ...info.results.filter((i) => !flate.results.some((f) => f.mmsi === i.mmsi)).map((i) => ({
        kategori: 'Flåte & båtinfo', id: `inf${i.mmsi}`, tittel: i.navn,
        sub: [i.rederi, i.kaptein_navn && `Kaptein ${i.kaptein_navn.replace(/^(kaptein|captain)\s+/i, '')}${i.kaptein_tlf ? ` ${i.kaptein_tlf}` : ''}`, i.chief_navn && `Chief ${i.chief_navn.replace(/^chief\s+/i, '')}`, i.agent_navn && `Agent ${i.agent_navn}`].filter(Boolean).join(' · ') || 'Kontaktinfo',
        href: `#/flate?mmsi=${i.mmsi}`,
      })),
      ...frv.results.map((f) => ({
        kategori: 'Kalender', id: `frv${f.id}`, tittel: `${f.navn} – ${f.kategori}${f.tittel ? `: ${f.tittel}` : ''}`,
        sub: `${dato(f.dato_fra)}${f.dato_til !== f.dato_fra ? ` – ${dato(f.dato_til)}` : ''} · ${f.tid_fra ? `${f.tid_fra}–${f.tid_til}` : 'hele dagen'}`, href: `#/kalender?dato=${f.dato_fra}`,
      })),
      ...prod.results.map((x) => ({ kategori: 'Produkter', id: `prod${x.id}`, tittel: `${x.navn} · ${x.produktnr}`, sub: `${x.type}${x.beskrivelse ? ` – ${x.beskrivelse.slice(0, 70)}` : ''}`, href: `#/admin?produkt=${x.id}` })),
      ...ais.filter((f) => !iFlate.has(f.mmsi)).slice(0, 6).map((f) => ({
        kategori: 'Båter i AIS', id: `ais${f.mmsi}`, tittel: f.navn || `MMSI ${f.mmsi}`,
        sub: `${f.imo ? `IMO ${f.imo} · ` : ''}MMSI ${f.mmsi} · vis på kartet`, href: `#/flate?ais=${f.mmsi}`,
      })),
      ...brk.results.map((u) => ({ kategori: 'Kolleger', id: `usr${u.id}`, tittel: u.navn, sub: `${u.rolle} · ${u.epost}`, href: '#/kalender' })),
    ];
    return c.json(ut);
  });
}
