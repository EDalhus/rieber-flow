import type { Hono } from 'hono';
import type { Env } from './types';
import { hentBruker, now } from './bruker';

const OPERASJON = ['Lasting', 'Lossing'];
const VARETYPE = ['Bulk', 'Pallevarer', 'Begge'];
const VURDERING = ['Bra', 'Merknad', 'Avvik', 'Ikke vurdert'];
const MAKS_BILDE = 1_200_000; // byte – en D1-rad tåler 2 MB, og base64 øker størrelsen med 1/3

type Foering = {
  baatnavn?: string; mmsi?: string | null; batanlop_id?: number | null; kai_dato?: string; operasjon?: string;
  varetype?: string; tonn?: number | null; vurdering?: string; tilbakemelding?: string;
};

function valider(b: Foering): string | null {
  if (!b.baatnavn?.trim()) return 'Båtnavn kreves';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.kai_dato ?? '')) return 'Ugyldig dato';
  if (!OPERASJON.includes(b.operasjon ?? '')) return 'Operasjon må være Lasting eller Lossing';
  if (!VARETYPE.includes(b.varetype ?? '')) return 'Varetype må være Bulk, Pallevarer eller Begge';
  if (b.vurdering && !VURDERING.includes(b.vurdering)) return 'Ugyldig vurdering';
  if (b.tonn != null && !(b.tonn >= 0)) return 'Ugyldig tonn';
  if ((b.tilbakemelding ?? '').length > 4000) return 'Tilbakemeldingen er for lang';
  return null;
}

export function tilBase64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function kaibokRoutes(app: Hono<Env>) {
  /** Liste med filtre. `baat` viser alle anløp for samme båt. */
  app.get('/api/kaibok', async (c) => {
    const q = c.req.query();
    const vilkar: string[] = [];
    const args: unknown[] = [];
    if (q.baat) { vilkar.push('lower(k.baatnavn) = lower(?)'); args.push(q.baat); }
    if (OPERASJON.includes(q.operasjon)) { vilkar.push('k.operasjon = ?'); args.push(q.operasjon); }
    if (VARETYPE.includes(q.varetype)) { vilkar.push('k.varetype = ?'); args.push(q.varetype); }
    if (VURDERING.includes(q.vurdering)) { vilkar.push('k.vurdering = ?'); args.push(q.vurdering); }
    if (q.fra) { vilkar.push('k.kai_dato >= ?'); args.push(q.fra); }
    if (q.til) { vilkar.push('k.kai_dato <= ?'); args.push(q.til); }
    if (q.q) { vilkar.push('(k.baatnavn LIKE ? OR k.tilbakemelding LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    const { results } = await c.env.DB.prepare(
      `SELECT k.*,
         (SELECT COUNT(*) FROM KaibokBilder b WHERE b.foering_id = k.id) AS antall_bilder,
         (SELECT COUNT(*) FROM Kaibok k2 WHERE lower(k2.baatnavn) = lower(k.baatnavn)) AS antall_anlop
       FROM Kaibok k ${vilkar.length ? `WHERE ${vilkar.join(' AND ')}` : ''}
       ORDER BY k.kai_dato DESC, k.id DESC LIMIT 500`,
    ).bind(...args).all();
    return c.json(results);
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
    ).bind(id).first();
    if (!f) return c.json({ error: 'Ikke funnet' }, 404);
    const { results: bilder } = await c.env.DB.prepare(
      'SELECT id, filnavn, storrelse, opplastet FROM KaibokBilder WHERE foering_id = ? ORDER BY id',
    ).bind(id).all();
    return c.json({ ...f, bilder });
  });

  app.post('/api/kaibok', async (c) => {
    const b = await c.req.json<Foering>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const { bruker } = await hentBruker(c);
    const r = await c.env.DB.prepare(
      `INSERT INTO Kaibok (batanlop_id, baatnavn, mmsi, kai_dato, operasjon, varetype, tonn, vurdering, tilbakemelding, opprettet_av, opprettet)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(b.batanlop_id ?? null, b.baatnavn!.trim(), b.mmsi ?? null, b.kai_dato, b.operasjon, b.varetype, b.tonn ?? null,
      b.vurdering ?? 'Ikke vurdert', (b.tilbakemelding ?? '').trim(), bruker.id, now()).run();
    return c.json({ id: r.meta.last_row_id }, 201);
  });

  app.put('/api/kaibok/:id', async (c) => {
    const id = +c.req.param('id');
    const b = await c.req.json<Foering>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    await c.env.DB.prepare(
      `UPDATE Kaibok SET baatnavn=?, kai_dato=?, operasjon=?, varetype=?, tonn=?, vurdering=?, tilbakemelding=? WHERE id=?`,
    ).bind(b.baatnavn!.trim(), b.kai_dato, b.operasjon, b.varetype, b.tonn ?? null, b.vurdering ?? 'Ikke vurdert', (b.tilbakemelding ?? '').trim(), id).run();
    return c.json({ ok: true });
  });

  app.delete('/api/kaibok/:id', async (c) => {
    await c.env.DB.prepare('DELETE FROM Kaibok WHERE id=?').bind(+c.req.param('id')).run();
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
