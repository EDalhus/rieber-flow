import type { Hono } from 'hono';
import type { Env } from './types';
import { hentBruker, now } from './bruker';

const KATEGORIER = ['Lege/tannlege', 'Verksted/bil', 'Skole/barn', 'Ferie', 'Sykdom', 'Annet', 'Ikke overtid'];
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const TID = /^([01]\d|2[0-3]):[0-5]\d$/;

type FravaerInn = { kategori?: string; tittel?: string; dato_fra?: string; dato_til?: string; tid_fra?: string | null; tid_til?: string | null; ikke_overtid?: boolean };

function valider(b: FravaerInn): string | null {
  if (!KATEGORIER.includes(b.kategori ?? '')) return 'Ugyldig kategori';
  if (!DATO.test(b.dato_fra ?? '') || !DATO.test(b.dato_til ?? '')) return 'Ugyldig dato';
  if (b.dato_til! < b.dato_fra!) return 'Sluttdato kan ikke være før startdato';
  if (!!b.tid_fra !== !!b.tid_til) return 'Oppgi både fra- og til-klokkeslett, eller ingen (hel dag)';
  if (b.tid_fra && (!TID.test(b.tid_fra) || !TID.test(b.tid_til!))) return 'Ugyldig klokkeslett';
  if (b.tid_fra && b.dato_fra === b.dato_til && b.tid_til! <= b.tid_fra) return 'Sluttid må være etter starttid';
  if ((b.tittel ?? '').length > 120) return 'Beskrivelsen er for lang';
  return null;
}

const osloDato = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
const osloTid = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

export function kalenderRoutes(app: Hono<Env>) {
  /** Alt kalenderen trenger for et tidsrom: båtanløp (kommende + historikk) og kollegaenes fravær. */
  app.get('/api/kalender', async (c) => {
    const fra = c.req.query('fra') ?? '';
    const til = c.req.query('til') ?? '';
    if (!DATO.test(fra) || !DATO.test(til)) return c.json({ error: 'fra og til (YYYY-MM-DD) kreves' }, 400);
    const db = c.env.DB;
    const { bruker } = await hentBruker(c);

    // Marginer for tidssone: hent litt bredere og filtrer på lokal (Oslo) dato
    const bredt = (d: string, dager: number) => new Date(Date.parse(d) + dager * 86400000).toISOString();
    const [bat, kai, frv, ansatte] = await Promise.all([
      db.prepare('SELECT id, skipsnavn, eta, status FROM Batanlop WHERE eta >= ? AND eta <= ?').bind(bredt(fra, -1), bredt(til, 2)).all<any>(),
      db.prepare('SELECT id, baatnavn, kai_dato, operasjon, varetype, vurdering FROM Kaibok WHERE batanlop_id IS NULL AND kai_dato BETWEEN ? AND ?').bind(fra, til).all<any>(),
      db.prepare(
        `SELECT f.*, b.navn, b.rolle FROM Fravaer f JOIN Brukere b ON b.id = f.bruker_id
         WHERE f.dato_til >= ? AND f.dato_fra <= ? ORDER BY f.dato_fra, f.tid_fra`,
      ).bind(fra, til).all<any>(),
      db.prepare('SELECT COUNT(*) AS n FROM Brukere').first<{ n: number }>(),
    ]);

    const anlop = [
      ...bat.results.map((b) => ({
        type: 'anlop' as const, id: b.id, navn: b.skipsnavn, dato: osloDato(b.eta), tid: osloTid(b.eta), status: b.status, href: `#/anlop/${b.id}`,
      })),
      ...kai.results.map((k) => ({
        type: 'kaibok' as const, id: k.id, navn: k.baatnavn, dato: k.kai_dato, tid: null, status: k.operasjon, varetype: k.varetype, vurdering: k.vurdering, href: `#/kaibok?id=${k.id}`,
      })),
    ].filter((a) => a.dato >= fra && a.dato <= til).sort((a, b) => a.dato.localeCompare(b.dato) || (a.tid ?? '').localeCompare(b.tid ?? ''));

    return c.json({ anlop, fravaer: frv.results, antallAnsatte: ansatte?.n ?? 0, meg: bruker.id });
  });

  app.post('/api/fravaer', async (c) => {
    const b = await c.req.json<FravaerInn>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const { bruker } = await hentBruker(c);
    const r = await c.env.DB.prepare(
      `INSERT INTO Fravaer (bruker_id, kategori, tittel, dato_fra, dato_til, tid_fra, tid_til, ikke_overtid, opprettet) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(bruker.id, b.kategori, (b.tittel ?? '').trim(), b.dato_fra, b.dato_til, b.tid_fra ?? null, b.tid_til ?? null,
      b.ikke_overtid || b.kategori === 'Ikke overtid' ? 1 : 0, now()).run();
    return c.json({ id: r.meta.last_row_id }, 201);
  });

  // Bare eier kan endre/slette egne føringer
  app.put('/api/fravaer/:id', async (c) => {
    const b = await c.req.json<FravaerInn>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const { bruker } = await hentBruker(c);
    const r = await c.env.DB.prepare(
      `UPDATE Fravaer SET kategori=?, tittel=?, dato_fra=?, dato_til=?, tid_fra=?, tid_til=?, ikke_overtid=? WHERE id=? AND bruker_id=?`,
    ).bind(b.kategori, (b.tittel ?? '').trim(), b.dato_fra, b.dato_til, b.tid_fra ?? null, b.tid_til ?? null,
      b.ikke_overtid || b.kategori === 'Ikke overtid' ? 1 : 0, +c.req.param('id'), bruker.id).run();
    return r.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Du kan bare endre dine egne føringer' }, 403);
  });

  app.delete('/api/fravaer/:id', async (c) => {
    const { bruker } = await hentBruker(c);
    const r = await c.env.DB.prepare('DELETE FROM Fravaer WHERE id=? AND bruker_id=?').bind(+c.req.param('id'), bruker.id).run();
    return r.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Du kan bare slette dine egne føringer' }, 403);
  });
}
