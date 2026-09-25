import type { Hono } from 'hono';
import type { Env } from './types';
import { hentBruker, now } from './bruker';

const OPERASJON = ['Lasting', 'Lossing'];
const VARETYPE = ['Bulk', 'Pallevarer', 'Begge'];
const VURDERING = ['Bra', 'Merknad', 'Avvik', 'Ikke vurdert'];
const MAKS_BILDE = 1_200_000; // byte – en D1-rad tåler 2 MB, og base64 øker størrelsen med 1/3

type LinjeInn = { produkt_id: number; antall: number };
type Foering = {
  baatnavn?: string; mmsi?: string | null; batanlop_id?: number | null; kai_dato?: string; operasjon?: string;
  varetype?: string; tonn?: number | null; vurdering?: string; tilbakemelding?: string; linjer?: LinjeInn[];
};

function valider(b: Foering): string | null {
  if (!b.baatnavn?.trim()) return 'Båtnavn kreves';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.kai_dato ?? '')) return 'Ugyldig dato';
  if (!OPERASJON.includes(b.operasjon ?? '')) return 'Operasjon må være Lasting eller Lossing';
  if (b.vurdering && !VURDERING.includes(b.vurdering)) return 'Ugyldig vurdering';
  if ((b.tilbakemelding ?? '').length > 4000) return 'Tilbakemeldingen er for lang';
  for (const l of b.linjer ?? []) if (!Number.isInteger(l.produkt_id) || !(l.antall > 0)) return 'Ugyldig produktlinje (velg produkt og antall større enn 0)';
  return null;
}

export function tilBase64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Varetype og tonn utledes av produktlinjene. */
async function beregn(db: D1Database, linjer: LinjeInn[]): Promise<{ varetype: string; tonn: number } | string> {
  const ids = [...new Set(linjer.map((l) => l.produkt_id))];
  const { results } = await db.prepare(`SELECT id, type, kg_per_enhet FROM Produkter WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: number; type: string; kg_per_enhet: number }>();
  if (results.length !== ids.length) return 'Ukjent produkt i føringen';
  const p = new Map(results.map((x) => [x.id, x]));
  const bulk = linjer.some((l) => p.get(l.produkt_id)!.type === 'Bulk');
  const pall = linjer.some((l) => p.get(l.produkt_id)!.type !== 'Bulk');
  const tonn = linjer.reduce((sum, l) => sum + (l.antall * p.get(l.produkt_id)!.kg_per_enhet) / 1000, 0);
  return { varetype: bulk && pall ? 'Begge' : pall ? 'Pallevarer' : 'Bulk', tonn: Math.round(tonn * 100) / 100 };
}

/** Lagerbevegelse: lossing legger til, lasting trekker fra. `retning` -1 reverserer en tidligere føring. */
const lagerBevegelse = (db: D1Database, operasjon: string, linjer: LinjeInn[], retning: 1 | -1) =>
  linjer.map((l) => db.prepare('UPDATE Produkter SET lager = MAX(0, lager + ?) WHERE id = ?').bind((operasjon === 'Lossing' ? 1 : -1) * retning * l.antall, l.produkt_id));

const LINJE_SQL = `SELECT l.id, l.foering_id, l.produkt_id, l.antall, p.produktnr, p.navn AS produkt, p.type, p.enhet, p.kg_per_enhet, p.pallertype, p.fargekode, p.lager, p.aktiv
  FROM KaibokLinjer l JOIN Produkter p ON p.id = l.produkt_id`;

async function medLinjer<T extends { id: number }>(db: D1Database, rader: T[]) {
  if (rader.length === 0) return [];
  const { results } = await db.prepare(`${LINJE_SQL} WHERE l.foering_id IN (${rader.map(() => '?').join(',')}) ORDER BY l.id`).bind(...rader.map((r) => r.id)).all<any>();
  return rader.map((r) => ({ ...r, linjer: results.filter((l) => l.foering_id === r.id) }));
}

export function kaibokRoutes(app: Hono<Env>) {
  /** Liste med filtre. `baat` viser alle anløp for samme båt, `produkt` alle føringer med et bestemt produkt. */
  app.get('/api/kaibok', async (c) => {
    const q = c.req.query();
    const vilkar: string[] = [];
    const args: unknown[] = [];
    if (q.baat) { vilkar.push('lower(k.baatnavn) = lower(?)'); args.push(q.baat); }
    if (OPERASJON.includes(q.operasjon)) { vilkar.push('k.operasjon = ?'); args.push(q.operasjon); }
    if (VARETYPE.includes(q.varetype)) { vilkar.push('k.varetype = ?'); args.push(q.varetype); }
    if (VURDERING.includes(q.vurdering)) { vilkar.push('k.vurdering = ?'); args.push(q.vurdering); }
    if (+q.produkt > 0) { vilkar.push('EXISTS (SELECT 1 FROM KaibokLinjer x WHERE x.foering_id = k.id AND x.produkt_id = ?)'); args.push(+q.produkt); }
    if (q.fra) { vilkar.push('k.kai_dato >= ?'); args.push(q.fra); }
    if (q.til) { vilkar.push('k.kai_dato <= ?'); args.push(q.til); }
    if (q.q) { vilkar.push('(k.baatnavn LIKE ? OR k.tilbakemelding LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    const { results } = await c.env.DB.prepare(
      `SELECT k.*,
         (SELECT COUNT(*) FROM KaibokBilder b WHERE b.foering_id = k.id) AS antall_bilder,
         (SELECT COUNT(*) FROM Kaibok k2 WHERE lower(k2.baatnavn) = lower(k.baatnavn)) AS antall_anlop
       FROM Kaibok k ${vilkar.length ? `WHERE ${vilkar.join(' AND ')}` : ''}
       ORDER BY k.kai_dato DESC, k.id DESC LIMIT 500`,
    ).bind(...args).all<any>();
    return c.json(await medLinjer(c.env.DB, results));
  });

  /** Båter som har vært til kai, med antall anløp (til filteret). */
  app.get('/api/kaibok/baater', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT MIN(baatnavn) AS baatnavn, COUNT(*) AS antall, MAX(kai_dato) AS siste, MIN(kai_dato) AS forste,
              SUM(vurdering = 'Avvik') AS avvik
       FROM Kaibok GROUP BY lower(baatnavn) ORDER BY lower(baatnavn)`,
    ).all();
    return c.json(results);
  });

  app.get('/api/kaibok/:id', async (c) => {
    const id = +c.req.param('id');
    const f = await c.env.DB.prepare(
      `SELECT k.*, b.navn AS opprettet_av_navn FROM Kaibok k LEFT JOIN Brukere b ON b.id = k.opprettet_av WHERE k.id = ?`,
    ).bind(id).first<any>();
    if (!f) return c.json({ error: 'Ikke funnet' }, 404);
    const { results: bilder } = await c.env.DB.prepare(
      'SELECT id, filnavn, storrelse, opplastet FROM KaibokBilder WHERE foering_id = ? ORDER BY id',
    ).bind(id).all();
    return c.json({ ...(await medLinjer(c.env.DB, [f]))[0], bilder });
  });

  app.post('/api/kaibok', async (c) => {
    const b = await c.req.json<Foering>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const linjer = b.linjer ?? [];
    if (linjer.length === 0) return c.json({ error: 'Velg minst ett produkt' }, 400);
    const d = await beregn(c.env.DB, linjer);
    if (typeof d === 'string') return c.json({ error: d }, 400);
    const { bruker } = await hentBruker(c);
    const r = await c.env.DB.prepare(
      `INSERT INTO Kaibok (batanlop_id, baatnavn, mmsi, kai_dato, operasjon, varetype, tonn, vurdering, tilbakemelding, opprettet_av, opprettet, lager_fort)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    ).bind(b.batanlop_id ?? null, b.baatnavn!.trim(), b.mmsi ?? null, b.kai_dato, b.operasjon, d.varetype, d.tonn,
      b.vurdering ?? 'Ikke vurdert', (b.tilbakemelding ?? '').trim(), bruker.id, now()).run();
    const id = r.meta.last_row_id;
    await c.env.DB.batch([
      ...linjer.map((l) => c.env.DB.prepare('INSERT INTO KaibokLinjer (foering_id, produkt_id, antall) VALUES (?,?,?)').bind(id, l.produkt_id, l.antall)),
      ...lagerBevegelse(c.env.DB, b.operasjon!, linjer, 1),
    ]);
    return c.json({ id }, 201);
  });

  /** Endring reverserer den gamle lagerbevegelsen og bruker den nye – i én batch. */
  app.put('/api/kaibok/:id', async (c) => {
    const id = +c.req.param('id');
    const b = await c.req.json<Foering>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const db = c.env.DB;
    const gammel = await db.prepare('SELECT operasjon, lager_fort, varetype, tonn FROM Kaibok WHERE id = ?').bind(id).first<{ operasjon: string; lager_fort: number; varetype: string; tonn: number | null }>();
    if (!gammel) return c.json({ error: 'Ikke funnet' }, 404);
    const { results: gamleLinjer } = await db.prepare('SELECT produkt_id, antall FROM KaibokLinjer WHERE foering_id = ?').bind(id).all<LinjeInn>();
    const linjer = b.linjer ?? [];
    let varetype = gammel.varetype, tonn = gammel.tonn;
    if (linjer.length === 0) {
      if (gamleLinjer.length > 0) return c.json({ error: 'Velg minst ett produkt' }, 400);
      if (VARETYPE.includes(b.varetype ?? '')) varetype = b.varetype!; // eldre føring uten produkter
      if (b.tonn !== undefined) tonn = b.tonn;
    } else {
      const d = await beregn(db, linjer);
      if (typeof d === 'string') return c.json({ error: d }, 400);
      varetype = d.varetype; tonn = d.tonn;
    }
    const fort = gammel.lager_fort === 1;
    await db.batch([
      ...(fort ? lagerBevegelse(db, gammel.operasjon, gamleLinjer, -1) : []),
      db.prepare('DELETE FROM KaibokLinjer WHERE foering_id = ?').bind(id),
      db.prepare('UPDATE Kaibok SET baatnavn=?, kai_dato=?, operasjon=?, varetype=?, tonn=?, vurdering=?, tilbakemelding=? WHERE id=?')
        .bind(b.baatnavn!.trim(), b.kai_dato, b.operasjon, varetype, tonn ?? null, b.vurdering ?? 'Ikke vurdert', (b.tilbakemelding ?? '').trim(), id),
      ...linjer.map((l) => db.prepare('INSERT INTO KaibokLinjer (foering_id, produkt_id, antall) VALUES (?,?,?)').bind(id, l.produkt_id, l.antall)),
      ...(fort ? lagerBevegelse(db, b.operasjon!, linjer, 1) : []),
    ]);
    return c.json({ ok: true });
  });

  /** Sletting reverserer lagerbevegelsen. */
  app.delete('/api/kaibok/:id', async (c) => {
    const id = +c.req.param('id');
    const db = c.env.DB;
    const gammel = await db.prepare('SELECT operasjon, lager_fort FROM Kaibok WHERE id = ?').bind(id).first<{ operasjon: string; lager_fort: number }>();
    if (!gammel) return c.json({ ok: true });
    const { results: linjer } = await db.prepare('SELECT produkt_id, antall FROM KaibokLinjer WHERE foering_id = ?').bind(id).all<LinjeInn>();
    await db.batch([
      ...(gammel.lager_fort === 1 ? lagerBevegelse(db, gammel.operasjon, linjer, -1) : []),
      db.prepare('DELETE FROM Kaibok WHERE id = ?').bind(id),
    ]);
    return c.json({ ok: true });
  });

  // ---- Bilder ----

  app.post('/api/kaibok/:id/bilder', async (c) => {
    const id = +c.req.param('id');
    const finnes = await c.env.DB.prepare('SELECT id FROM Kaibok WHERE id=?').bind(id).first();
    if (!finnes) return c.json({ error: 'Føringen finnes ikke' }, 404);
    const skjema = await c.req.formData();
    const filer = skjema.getAll('bilde').filter((f): f is File => typeof f !== 'string');
    if (filer.length === 0) return c.json({ error: 'Ingen bilder' }, 400);
    const stmts: D1PreparedStatement[] = [];
    for (const f of filer) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return c.json({ error: `${f.name}: kun JPEG, PNG eller WebP` }, 400);
      if (f.size > MAKS_BILDE) return c.json({ error: `${f.name} er for stort (maks ${Math.round(MAKS_BILDE / 1000)} kB etter komprimering)` }, 413);
      stmts.push(
        c.env.DB.prepare('INSERT INTO KaibokBilder (foering_id, filnavn, content_type, storrelse, data, opplastet) VALUES (?,?,?,?,?,?)')
          .bind(id, f.name.slice(0, 120), f.type, f.size, tilBase64(await f.arrayBuffer()), now()),
      );
    }
    await c.env.DB.batch(stmts);
    return c.json({ ok: true, antall: stmts.length }, 201);
  });

  app.get('/api/kaibok/bilder/:bildeId', async (c) => {
    const r = await c.env.DB.prepare('SELECT content_type, data FROM KaibokBilder WHERE id=?').bind(+c.req.param('bildeId')).first<{ content_type: string; data: string }>();
    if (!r) return c.notFound();
    const bytes = Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': r.content_type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  });

  app.delete('/api/kaibok/bilder/:bildeId', async (c) => {
    await c.env.DB.prepare('DELETE FROM KaibokBilder WHERE id=?').bind(+c.req.param('bildeId')).run();
    return c.json({ ok: true });
  });
}
