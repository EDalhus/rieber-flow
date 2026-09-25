import type { Hono } from 'hono';
import type { Env } from './types';
import { hentBruker, now } from './bruker';
import { tilBase64 } from './kaibok';

const MAKS_BILDE = 1_200_000;
const FELT = ['rederi', 'kaptein_navn', 'kaptein_tlf', 'chief_navn', 'chief_tlf', 'epost', 'agent_navn', 'agent_tlf', 'vhf_kanal', 'kapasitet', 'bilde_url'] as const;
const erMmsi = (m: string) => /^\d{9}$/.test(m);

/** Brukerstyrt båtinfo (kontakter, notater) og egne bilder. Delt mellom alle brukere. */
export function fartoyRoutes(app: Hono<Env>) {
  app.get('/api/fartoy/:mmsi', async (c) => {
    const mmsi = c.req.param('mmsi');
    if (!erMmsi(mmsi)) return c.json({ error: 'Ugyldig MMSI' }, 400);
    const info = await c.env.DB.prepare(
      'SELECT i.*, b.navn AS oppdatert_av_navn FROM FartoyInfo i LEFT JOIN Brukere b ON b.id = i.oppdatert_av WHERE i.mmsi = ?',
    ).bind(mmsi).first();
    const { results: bilder } = await c.env.DB.prepare('SELECT id, hoved, opplastet FROM FartoyBilde WHERE mmsi = ? ORDER BY hoved DESC, id DESC').bind(mmsi).all();
    return c.json({ mmsi, info: info ?? null, bilder });
  });

  app.put('/api/fartoy/:mmsi', async (c) => {
    const mmsi = c.req.param('mmsi');
    if (!erMmsi(mmsi)) return c.json({ error: 'Ugyldig MMSI' }, 400);
    const b = await c.req.json<Record<string, string>>();
    for (const k of FELT) if ((b[k] ?? '').length > 300) return c.json({ error: `${k} er for langt` }, 400);
    if ((b.notater ?? '').length > 4000) return c.json({ error: 'Notatene er for lange' }, 400);
    if (b.bilde_url && !/^https:\/\//i.test(b.bilde_url)) return c.json({ error: 'Bilde-lenken må starte med https://' }, 400);
    const { bruker } = await hentBruker(c);
    const v = (k: string) => (b[k] ?? '').trim();
    await c.env.DB.prepare(
      `INSERT INTO FartoyInfo (mmsi, rederi, kaptein_navn, kaptein_tlf, chief_navn, chief_tlf, epost, agent_navn, agent_tlf, vhf_kanal, kapasitet, bilde_url, notater, oppdatert, oppdatert_av)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(mmsi) DO UPDATE SET rederi=excluded.rederi, kaptein_navn=excluded.kaptein_navn, kaptein_tlf=excluded.kaptein_tlf,
         chief_navn=excluded.chief_navn, chief_tlf=excluded.chief_tlf, epost=excluded.epost, agent_navn=excluded.agent_navn, agent_tlf=excluded.agent_tlf,
         vhf_kanal=excluded.vhf_kanal, kapasitet=excluded.kapasitet, bilde_url=excluded.bilde_url, notater=excluded.notater,
         oppdatert=excluded.oppdatert, oppdatert_av=excluded.oppdatert_av`,
    ).bind(mmsi, v('rederi'), v('kaptein_navn'), v('kaptein_tlf'), v('chief_navn'), v('chief_tlf'), v('epost'), v('agent_navn'), v('agent_tlf'),
      v('vhf_kanal'), v('kapasitet'), v('bilde_url'), v('notater'), now(), bruker.id).run();
    return c.json({ ok: true });
  });

  // ---- Egne bilder (det nyeste blir hovedbilde og erstatter evt. bilde-lenken) ----

  app.post('/api/fartoy/:mmsi/bilder', async (c) => {
    const mmsi = c.req.param('mmsi');
    if (!erMmsi(mmsi)) return c.json({ error: 'Ugyldig MMSI' }, 400);
    const filer = (await c.req.formData()).getAll('bilde').filter((f): f is File => typeof f !== 'string');
    if (filer.length === 0) return c.json({ error: 'Ingen bilder' }, 400);
    const stmts: D1PreparedStatement[] = [];
    for (const f of filer) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return c.json({ error: `${f.name}: kun JPEG, PNG eller WebP` }, 400);
      if (f.size > MAKS_BILDE) return c.json({ error: `${f.name} er for stort etter komprimering` }, 413);
      stmts.push(c.env.DB.prepare('INSERT INTO FartoyBilde (mmsi, content_type, storrelse, data, hoved, opplastet) VALUES (?,?,?,?,0,?)')
        .bind(mmsi, f.type, f.size, tilBase64(await f.arrayBuffer()), now()));
    }
    await c.env.DB.batch(stmts);
    // Siste opplastede bilde blir hovedbilde
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE FartoyBilde SET hoved = 0 WHERE mmsi = ?').bind(mmsi),
      c.env.DB.prepare('UPDATE FartoyBilde SET hoved = 1 WHERE id = (SELECT MAX(id) FROM FartoyBilde WHERE mmsi = ?)').bind(mmsi),
    ]);
    return c.json({ ok: true }, 201);
  });

  app.get('/api/fartoy/bilder/:id', async (c) => {
    const r = await c.env.DB.prepare('SELECT content_type, data FROM FartoyBilde WHERE id=?').bind(+c.req.param('id')).first<{ content_type: string; data: string }>();
    if (!r) return c.notFound();
    return new Response(Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0)), {
      headers: { 'Content-Type': r.content_type, 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  });

  app.put('/api/fartoy/bilder/:id/hoved', async (c) => {
    const id = +c.req.param('id');
    const r = await c.env.DB.prepare('SELECT mmsi FROM FartoyBilde WHERE id=?').bind(id).first<{ mmsi: string }>();
    if (!r) return c.json({ error: 'Ikke funnet' }, 404);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE FartoyBilde SET hoved = 0 WHERE mmsi = ?').bind(r.mmsi),
      c.env.DB.prepare('UPDATE FartoyBilde SET hoved = 1 WHERE id = ?').bind(id),
    ]);
    return c.json({ ok: true });
  });

  app.delete('/api/fartoy/bilder/:id', async (c) => {
    const id = +c.req.param('id');
    const r = await c.env.DB.prepare('SELECT mmsi, hoved FROM FartoyBilde WHERE id=?').bind(id).first<{ mmsi: string; hoved: number }>();
    if (!r) return c.json({ ok: true });
    await c.env.DB.prepare('DELETE FROM FartoyBilde WHERE id=?').bind(id).run();
    if (r.hoved) await c.env.DB.prepare('UPDATE FartoyBilde SET hoved = 1 WHERE id = (SELECT MAX(id) FROM FartoyBilde WHERE mmsi = ?)').bind(r.mmsi).run();
    return c.json({ ok: true });
  });
}
