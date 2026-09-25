import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ensureDb, resetDb } from './db';
import type { Env } from './types';
import { hentBruker, now, type Bruker } from './bruker';
import { kaibokRoutes } from './kaibok';
import { fartoyRoutes } from './fartoy';
import { sokRoutes } from './sok';
import { vaerRoutes } from './vaer';
import { kalenderRoutes } from './kalender';
import { diagnose, kilde, sistePosisjoner, sokFartoy, spor, type AisEnv } from './ais';


const app = new Hono<Env>();
app.use('/api/*', cors());
app.use('/api/*', async (c, next) => {
  await ensureDb(c.env.DB);
  await next();
});


// ---------- Varelager / dashboard ----------

app.get('/api/varelager', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM Varelager ORDER BY id').all();
  return c.json(results);
});

// Mock-statistikk: deterministisk pseudo-produksjon pr. dag (bigbags) og salg (tonn).
function dagsverdi(dagerSiden: number, seed: number, base: number, spenn: number) {
  const x = Math.sin((dagerSiden + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return Math.round(base + (x - Math.floor(x)) * spenn);
}

app.get('/api/dashboard', async (c) => {
  const varer = (await c.env.DB.prepare('SELECT * FROM Varelager ORDER BY id').all()).results as any[];
  const perioder = [1, 3, 7, 30, 90, 365].map((dager) => {
    let bigbags = 0;
    let salgTonn = 0;
    for (let d = 0; d < dager; d++) {
      bigbags += dagsverdi(d, 1, 60, 50);
      salgTonn += dagsverdi(d, 2, 220, 260);
    }
    return { dager, bigbags, salgTonn };
  });
  const produksjonPerDag = Array.from({ length: 30 }, (_, i) => {
    const d = 29 - i;
    const dato = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    return { dato, bigbags: dagsverdi(d, 1, 60, 50) };
  });
  const totalt = {
    tonn_bulk: varer.reduce((s, v) => s + v.tonn_bulk, 0),
    antall_bigbags: varer.reduce((s, v) => s + v.antall_bigbags, 0),
  };
  return c.json({ varer, totalt, perioder, produksjonPerDag });
});

// ---------- Båtanløp ----------

const BAT_SQL = `
  SELECT b.*,
    COALESCE((SELECT SUM(s.tonn) FROM BatLasteplan l JOIN Salgsordrer s ON s.id=l.so_id WHERE l.batanlop_id=b.id),0) AS tonn_totalt,
    COALESCE((SELECT SUM(s.tonn) FROM BatLasteplan l JOIN Salgsordrer s ON s.id=l.so_id WHERE l.batanlop_id=b.id AND l.status='Ferdig'),0) AS tonn_lastet,
    (SELECT COUNT(*) FROM BatLasteplan l WHERE l.batanlop_id=b.id) AS antall_steg
  FROM Batanlop b`;

app.get('/api/batanlop', async (c) => {
  const { results } = await c.env.DB.prepare(`${BAT_SQL} ORDER BY b.eta`).all();
  return c.json(results);
});

app.post('/api/batanlop', async (c) => {
  const b = await c.req.json<{ skipsnavn: string; eta: string; mmsi?: string }>();
  if (!b.skipsnavn || !b.eta) return c.json({ error: 'skipsnavn og eta kreves' }, 400);
  if (b.mmsi && !/^\d{9}$/.test(b.mmsi)) return c.json({ error: 'MMSI må være 9 siffer' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO Batanlop (skipsnavn, mmsi, eta) VALUES (?,?,?)')
    .bind(b.skipsnavn, b.mmsi || null, b.eta).run();
  return c.json({ id: r.meta.last_row_id }, 201);
});

app.patch('/api/batanlop/:id', async (c) => {
  const id = +c.req.param('id');
  const b = await c.req.json<{ skipsnavn?: string; eta?: string; status?: string; mmsi?: string | null }>();
  if (b.mmsi && !/^\d{9}$/.test(b.mmsi)) return c.json({ error: 'MMSI må være 9 siffer' }, 400);
  // mmsi: utelatt = uendret, tom streng/null = fjern koblingen
  await c.env.DB.prepare(
    `UPDATE Batanlop SET skipsnavn=COALESCE(?1,skipsnavn), eta=COALESCE(?2,eta), status=COALESCE(?3,status),
       mmsi=CASE WHEN ?4 = 1 THEN NULLIF(?5,'') ELSE mmsi END WHERE id=?6`,
  ).bind(b.skipsnavn ?? null, b.eta ?? null, b.status ?? null, 'mmsi' in b ? 1 : 0, b.mmsi ?? '', id).run();
  return c.json({ ok: true });
});

app.delete('/api/batanlop/:id', async (c) => {
  const id = +c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE Salgsordrer SET batanlop_id=NULL, status='Ny' WHERE batanlop_id=? AND status!='Ferdig'").bind(id),
    c.env.DB.prepare('DELETE FROM Batanlop WHERE id=?').bind(id),
  ]);
  return c.json({ ok: true });
});

const STEG_SQL = `
  SELECT l.id AS steg_id, l.batanlop_id, l.so_id, l.rekkefolge_nummer, l.status AS steg_status, l.ferdig_tidspunkt,
         s.ordrenummer, s.kunde, s.salttype, s.tonn, s.frist, v.fargekode
  FROM BatLasteplan l
  JOIN Salgsordrer s ON s.id=l.so_id
  JOIN Varelager v ON v.salttype=s.salttype`;

app.get('/api/batanlop/:id', async (c) => {
  const id = +c.req.param('id');
  const batanlop = await c.env.DB.prepare(`${BAT_SQL} WHERE b.id=?`).bind(id).first();
  if (!batanlop) return c.json({ error: 'Ikke funnet' }, 404);
  const { results: steg } = await c.env.DB.prepare(`${STEG_SQL} WHERE l.batanlop_id=? ORDER BY l.rekkefolge_nummer`).bind(id).all();
  return c.json({ batanlop, steg: await medLinjer(c.env.DB, steg, 'so_id') });
});

/** Erstatter lasteplanen med gitt rekkefølge av SO-er. Ferdige steg beholder status. */
app.put('/api/batanlop/:id/lasteplan', async (c) => {
  const id = +c.req.param('id');
  const { so_ids } = await c.req.json<{ so_ids: number[] }>();
  const db = c.env.DB;
  const bat = await db.prepare('SELECT status FROM Batanlop WHERE id=?').bind(id).first<{ status: string }>();
  if (!bat) return c.json({ error: 'Ikke funnet' }, 404);

  const { results: eksisterende } = await db
    .prepare('SELECT so_id, status FROM BatLasteplan WHERE batanlop_id=?').bind(id).all<{ so_id: number; status: string }>();
  const gammel = new Map(eksisterende.map((e) => [e.so_id, e.status]));
  // Ferdige steg er låst og må beholdes først i sekvensen
  const ferdige = eksisterende.filter((e) => e.status === 'Ferdig').map((e) => e.so_id);
  const rekkefolge = [...ferdige, ...so_ids.filter((s) => !ferdige.includes(s))];
  const fjernet = eksisterende.map((e) => e.so_id).filter((s) => !rekkefolge.includes(s));

  const forsteAktive = bat.status === 'Lasting' ? rekkefolge.find((s) => gammel.get(s) !== 'Ferdig') : undefined;
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM BatLasteplan WHERE batanlop_id=?').bind(id)];
  for (const s of fjernet) {
    stmts.push(db.prepare("UPDATE Salgsordrer SET batanlop_id=NULL, status='Ny' WHERE id=?").bind(s));
  }
  rekkefolge.forEach((so, i) => {
    const status = gammel.get(so) === 'Ferdig' ? 'Ferdig' : so === forsteAktive ? 'Aktiv' : 'Venter';
    stmts.push(
      db.prepare('INSERT INTO BatLasteplan (batanlop_id, so_id, rekkefolge_nummer, status) VALUES (?,?,?,?)').bind(id, so, i + 1, status),
      db.prepare('UPDATE Salgsordrer SET batanlop_id=?, status=? WHERE id=?')
        .bind(id, status === 'Ferdig' ? 'Ferdig' : status === 'Aktiv' ? 'Under lasting' : 'Planlagt', so),
    );
  });
  await db.batch(stmts);
  return c.json({ ok: true });
});

/** Start lasting: båten settes til Lasting og første ikke-ferdige steg blir Aktiv. */
app.post('/api/batanlop/:id/start', async (c) => {
  const id = +c.req.param('id');
  const db = c.env.DB;
  const neste = await db
    .prepare("SELECT id, so_id FROM BatLasteplan WHERE batanlop_id=? AND status!='Ferdig' ORDER BY rekkefolge_nummer LIMIT 1")
    .bind(id).first<{ id: number; so_id: number }>();
  if (!neste) return c.json({ error: 'Lasteplanen er tom eller ferdig' }, 400);
  // Kun én båt kan lastes av gangen – stopp evt. andre
  await db.batch([
    db.prepare("UPDATE Batanlop SET status='Ankommet' WHERE status='Lasting' AND id!=?").bind(id),
    db.prepare("UPDATE Batanlop SET status='Lasting' WHERE id=?").bind(id),
    db.prepare("UPDATE BatLasteplan SET status='Aktiv' WHERE id=?").bind(neste.id),
    db.prepare("UPDATE Salgsordrer SET status='Under lasting' WHERE id=?").bind(neste.so_id),
  ]);
  return c.json({ ok: true });
});

/** Marker steg ferdig → trekk fra lager, aktiver neste steg, avslutt båt hvis siste. */
app.post('/api/lasteplan/:stegId/ferdig', async (c) => {
  const stegId = +c.req.param('stegId');
  const db = c.env.DB;
  const steg = await db.prepare(
    `SELECT l.id, l.batanlop_id, l.so_id, l.status, s.salttype, s.tonn
     FROM BatLasteplan l JOIN Salgsordrer s ON s.id=l.so_id WHERE l.id=?`,
  ).bind(stegId).first<any>();
  if (!steg) return c.json({ error: 'Ikke funnet' }, 404);
  if (steg.status === 'Ferdig') return c.json({ ok: true });

  const neste = await db
    .prepare("SELECT id, so_id FROM BatLasteplan WHERE batanlop_id=? AND status='Venter' AND id!=? ORDER BY rekkefolge_nummer LIMIT 1")
    .bind(steg.batanlop_id, stegId).first<{ id: number; so_id: number }>();
  const stmts = [
    db.prepare("UPDATE BatLasteplan SET status='Ferdig', ferdig_tidspunkt=? WHERE id=?").bind(now(), stegId),
    db.prepare("UPDATE Salgsordrer SET status='Ferdig' WHERE id=?").bind(steg.so_id),
    db.prepare('UPDATE Varelager SET tonn_bulk=MAX(0, tonn_bulk-?) WHERE salttype=?').bind(steg.tonn, steg.salttype),
  ];
  if (neste) {
    stmts.push(
      db.prepare("UPDATE BatLasteplan SET status='Aktiv' WHERE id=?").bind(neste.id),
      db.prepare("UPDATE Salgsordrer SET status='Under lasting' WHERE id=?").bind(neste.so_id),
    );
  } else {
    stmts.push(db.prepare("UPDATE Batanlop SET status='Ferdig' WHERE id=?").bind(steg.batanlop_id));
  }
  await db.batch(stmts);
  if (!neste) await opprettKaibokFraAnlop(db, steg.batanlop_id);
  return c.json({ ok: true });
});

/** Ferdig lastet båt får en kaibok-føring automatisk (mannskapet fyller inn tilbakemelding etterpå). */
async function opprettKaibokFraAnlop(db: D1Database, batanlopId: number) {
  const bat = await db.prepare('SELECT skipsnavn, mmsi FROM Batanlop WHERE id=?').bind(batanlopId).first<{ skipsnavn: string; mmsi: string | null }>();
  if (!bat) return;
  const { results } = await db.prepare(
    `SELECT l.emballasje, SUM(l.antall*l.kg_per_enhet)/1000.0 AS tonn FROM BatLasteplan p
     JOIN SalgsordreLinjer l ON l.so_id=p.so_id WHERE p.batanlop_id=? GROUP BY l.emballasje`,
  ).bind(batanlopId).all<{ emballasje: string; tonn: number }>();
  const bulk = results.some((r) => r.emballasje === 'Bulk');
  const pall = results.some((r) => r.emballasje !== 'Bulk');
  await db.prepare(
    `INSERT OR IGNORE INTO Kaibok (batanlop_id, baatnavn, mmsi, kai_dato, operasjon, varetype, tonn, opprettet)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(batanlopId, bat.skipsnavn, bat.mmsi, new Date().toISOString().slice(0, 10), 'Lasting',
    bulk && pall ? 'Begge' : pall ? 'Pallevarer' : 'Bulk', results.reduce((s, r) => s + r.tonn, 0), now()).run();
}

type Linje = { so_id: number; [k: string]: unknown };

/** Legger SO-linjene (bulk / bigbag / pall) på hver rad. `key` er kolonnen som peker til SO-id. */
async function medLinjer<T extends Record<string, any>>(db: D1Database, rader: T[], key: 'id' | 'so_id'): Promise<(T & { linjer: Linje[] })[]> {
  if (rader.length === 0) return [];
  const ids = [...new Set(rader.map((r) => r[key] as number))];
  const { results } = await db
    .prepare(
      `SELECT l.*, v.fargekode FROM SalgsordreLinjer l JOIN Varelager v ON v.salttype=l.salttype
       WHERE l.so_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.id`,
    )
    .bind(...ids)
    .all<Linje>();
  return rader.map((r) => ({ ...r, linjer: results.filter((l) => l.so_id === r[key]) }));
}

// ---------- Salgsordrer ----------

const SO_SQL = `SELECT s.*, v.fargekode FROM Salgsordrer s JOIN Varelager v ON v.salttype=s.salttype`;

app.get('/api/salgsordrer', async (c) => {
  const { results } = await c.env.DB.prepare(`${SO_SQL} ORDER BY s.frist`).all();
  return c.json(await medLinjer(c.env.DB, results, 'id'));
});

/** SO-kø: ordrer uten båt (lastebil), ikke ferdige, kortest frist først. */
app.get('/api/so-ko', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SO_SQL} WHERE s.batanlop_id IS NULL AND s.status!='Ferdig' ORDER BY s.frist ASC`,
  ).all();
  return c.json(await medLinjer(c.env.DB, results, 'id'));
});

app.get('/api/salgsordrer/:id', async (c) => {
  const so = await c.env.DB.prepare(`${SO_SQL} WHERE s.id=?`).bind(+c.req.param('id')).first();
  if (!so) return c.json({ error: 'Ikke funnet' }, 404);
  return c.json((await medLinjer(c.env.DB, [so], 'id'))[0]);
});

type NyLinje = { produkt: string; salttype: string; emballasje: 'Bulk' | 'Bigbag' | 'Pall'; antall: number; enhet: string; kg_per_enhet: number };

/** Opprett SO. Med `linjer` beregnes tonn (og salttype) fra innholdet. */
app.post('/api/salgsordrer', async (c) => {
  const b = await c.req.json<{ ordrenummer: string; kunde: string; salttype?: string; tonn?: number; frist: string; linjer?: NyLinje[] }>();
  const linjer = b.linjer ?? [];
  const tonn = linjer.length ? linjer.reduce((s, l) => s + (l.antall * l.kg_per_enhet) / 1000, 0) : b.tonn;
  const salttype = linjer[0]?.salttype ?? b.salttype;
  if (!b.ordrenummer || !b.kunde || !salttype || !tonn || !(tonn > 0) || !b.frist) return c.json({ error: 'Ugyldig ordre' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO Salgsordrer (ordrenummer, kunde, salttype, tonn, frist) VALUES (?,?,?,?,?)')
    .bind(b.ordrenummer, b.kunde, salttype, tonn, b.frist).run();
  const id = r.meta.last_row_id;
  if (linjer.length) {
    await c.env.DB.batch(linjer.map((l) =>
      c.env.DB.prepare('INSERT INTO SalgsordreLinjer (so_id, produkt, salttype, emballasje, antall, enhet, kg_per_enhet) VALUES (?,?,?,?,?,?,?)')
        .bind(id, l.produkt, l.salttype, l.emballasje, l.antall, l.enhet, l.kg_per_enhet)));
  }
  return c.json({ id }, 201);
});

app.patch('/api/salgsordrer/:id', async (c) => {
  const id = +c.req.param('id');
  const b = await c.req.json<{ kunde?: string; salttype?: string; tonn?: number; frist?: string; status?: string }>();
  await c.env.DB.prepare(
    `UPDATE Salgsordrer SET kunde=COALESCE(?,kunde), salttype=COALESCE(?,salttype), tonn=COALESCE(?,tonn),
     frist=COALESCE(?,frist), status=COALESCE(?,status) WHERE id=?`,
  ).bind(b.kunde ?? null, b.salttype ?? null, b.tonn ?? null, b.frist ?? null, b.status ?? null, id).run();
  return c.json({ ok: true });
});

app.delete('/api/salgsordrer/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM Salgsordrer WHERE id=?').bind(+c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Lastebil-ordre ferdig (fjernes fra køen, trekkes fra lager). */
app.post('/api/salgsordrer/:id/ferdig', async (c) => {
  const id = +c.req.param('id');
  const so = await c.env.DB.prepare('SELECT salttype, tonn, status FROM Salgsordrer WHERE id=?').bind(id).first<any>();
  if (!so) return c.json({ error: 'Ikke funnet' }, 404);
  if (so.status !== 'Ferdig') {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE Salgsordrer SET status='Ferdig' WHERE id=?").bind(id),
      c.env.DB.prepare('UPDATE Varelager SET tonn_bulk=MAX(0, tonn_bulk-?) WHERE salttype=?').bind(so.tonn, so.salttype),
    ]);
  }
  return c.json({ ok: true });
});

// ---------- Sjåfør / Kjøre-modus ----------

/** Alt mobilappen trenger i ett kall. Båt-modus overstyrer alt annet. */
app.get('/api/sjafor', async (c) => {
  const db = c.env.DB;
  const bat = await db.prepare(`${BAT_SQL} WHERE b.status='Lasting' ORDER BY b.eta LIMIT 1`).first<any>();
  const varer = (await db.prepare('SELECT * FROM Varelager ORDER BY id').all()).results;
  if (bat) {
    const steg = (await db.prepare(`${STEG_SQL} WHERE l.batanlop_id=? ORDER BY l.rekkefolge_nummer`).bind(bat.id).all()).results as any[];
    const [aktiv = null, neste = null] = await Promise.all(
      [steg.find((s) => s.steg_status === 'Aktiv'), steg.find((s) => s.steg_status === 'Venter')].map(async (s) =>
        s ? (await medLinjer(db, [s], 'so_id'))[0] : undefined),
    );
    return c.json({ modus: 'bat', batanlop: bat, aktiv, neste, antall_steg: steg.length, varer });
  }
  const ko = await medLinjer(db, (await db.prepare(`${SO_SQL} WHERE s.batanlop_id IS NULL AND s.status!='Ferdig' ORDER BY s.frist LIMIT 3`).all()).results, 'id');
  return c.json({ modus: 'lastebil', ko, varer });
});

// ---------- Bruker og personlig dashboard ----------

app.get('/api/meg', async (c) => {
  const { bruker, demo } = await hentBruker(c);
  const brukere = demo ? (await c.env.DB.prepare('SELECT * FROM Brukere ORDER BY id').all<Bruker>()).results : [];
  return c.json({ bruker, demo, brukere });
});

app.get('/api/meg/dashboard', async (c) => {
  const { bruker } = await hentBruker(c);
  const rad = await c.env.DB.prepare('SELECT layout FROM DashboardLayout WHERE bruker_id=?').bind(bruker.id).first<{ layout: string }>();
  return c.json({ layout: rad ? JSON.parse(rad.layout) : null });
});

app.put('/api/meg/dashboard', async (c) => {
  const { bruker } = await hentBruker(c);
  const { layout } = await c.req.json<{ layout: unknown }>();
  const ok =
    Array.isArray(layout) && layout.length <= 50 &&
    layout.every((l: any) => typeof l?.i === 'string' && l.i.length < 64 && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(l[k])));
  if (!ok) return c.json({ error: 'Ugyldig layout' }, 400);
  const rent = (layout as any[]).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  await c.env.DB.prepare(
    `INSERT INTO DashboardLayout (bruker_id, layout, oppdatert) VALUES (?,?,?)
     ON CONFLICT(bruker_id) DO UPDATE SET layout=excluded.layout, oppdatert=excluded.oppdatert`,
  ).bind(bruker.id, JSON.stringify(rent), now()).run();
  return c.json({ ok: true });
});

/** Tilbake til standardoppsett. */
app.delete('/api/meg/dashboard', async (c) => {
  const { bruker } = await hentBruker(c);
  await c.env.DB.prepare('DELETE FROM DashboardLayout WHERE bruker_id=?').bind(bruker.id).run();
  return c.json({ ok: true });
});

// ---------- Flåte + kart (Barentswatch AIS) ----------

/** Brukerens flåte med siste kjente posisjon. Kun disse fartøyene sendes til kartet. */
app.get('/api/flate', async (c) => {
  const { bruker } = await hentBruker(c);
  const { results } = await c.env.DB.prepare('SELECT mmsi, navn FROM Flate WHERE bruker_id=? ORDER BY lagt_til, navn').bind(bruker.id).all<{ mmsi: string; navn: string }>();
  let posisjoner = new Map<string, any>();
  let feil: string | null = null;
  try {
    posisjoner = await sistePosisjoner(c.env, results.map((r) => r.mmsi));
  } catch (e) {
    feil = (e as Error).message;
  }
  return c.json({
    kilde: kilde(c.env), feil,
    fartoy: results.map((r) => ({ ...r, posisjon: posisjoner.get(r.mmsi) ?? null })),
  });
});

app.post('/api/flate', async (c) => {
  const { bruker } = await hentBruker(c);
  const b = await c.req.json<{ mmsi: string; navn?: string }>();
  if (!/^\d{9}$/.test(b.mmsi ?? '')) return c.json({ error: 'MMSI må være 9 siffer' }, 400);
  await c.env.DB.prepare('INSERT OR IGNORE INTO Flate (bruker_id, mmsi, navn, lagt_til) VALUES (?,?,?,?)')
    .bind(bruker.id, b.mmsi, (b.navn ?? '').trim() || `MMSI ${b.mmsi}`, now()).run();
  return c.json({ ok: true }, 201);
});

app.delete('/api/flate/:mmsi', async (c) => {
  const { bruker } = await hentBruker(c);
  await c.env.DB.prepare('DELETE FROM Flate WHERE bruker_id=? AND mmsi=?').bind(bruker.id, c.req.param('mmsi')).run();
  return c.json({ ok: true });
});

app.get('/api/ais/status', async (c) => c.json(await diagnose(c.env).catch((e) => ({ konklusjon: (e as Error).message }))));

app.get('/api/ais/sok', async (c) => {
  try {
    return c.json({ kilde: kilde(c.env), treff: await sokFartoy(c.env, c.req.query('q') ?? '', caches.default) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Siste posisjon for ett fartøy (også de som ikke er i flåten) – brukes når man søker seg til en båt. */
app.get('/api/ais/fartoy/:mmsi', async (c) => {
  const mmsi = c.req.param('mmsi');
  if (!/^\d{9}$/.test(mmsi)) return c.json({ error: 'Ugyldig MMSI' }, 400);
  try {
    const p = (await sistePosisjoner(c.env, [mmsi])).get(mmsi) ?? null;
    return c.json({ kilde: kilde(c.env), mmsi, posisjon: p });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get('/api/ais/spor/:mmsi', async (c) => {
  try {
    return c.json(await spor(c.env, c.req.param('mmsi')));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

kaibokRoutes(app);
fartoyRoutes(app);
sokRoutes(app);
vaerRoutes(app);
kalenderRoutes(app);

// ---------- Demo ----------

app.post('/api/admin/reset', async (c) => {
  await resetDb(c.env.DB);
  return c.json({ ok: true });
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Ikke funnet' }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: e.message }, 500);
});

export default app;
