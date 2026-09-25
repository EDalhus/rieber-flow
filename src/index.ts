import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ensureDb, resetDb } from './db';
import type { Env } from './types';
import { hentBruker, now, type Bruker } from './bruker';
import { kaibokRoutes } from './kaibok';
import { fartoyRoutes } from './fartoy';
import { sokRoutes } from './sok';
import { vaerRoutes } from './vaer';
import { produktRoutes } from './produkter';
import { kalenderRoutes } from './kalender';
import { diagnose, finnPaaImo, kilde, sistePosisjoner, sokFartoy, spor, type AisEnv } from './ais';
import { gyldigImo } from './imo';


const app = new Hono<Env>();
app.use('/api/*', cors());
app.use('/api/*', async (c, next) => {
  await ensureDb(c.env.DB);
  await next();
});


// ---------- Dashboard ----------

/** Utledede kolonner for en SO: navn på (første) produkt og fargekode – hentes fra ordrelinjene. */
const soKol = (a: string) => `
  COALESCE((SELECT p.navn FROM SalgsordreLinjer x JOIN Produkter p ON p.id=x.produkt_id WHERE x.so_id=${a}.id ORDER BY x.id LIMIT 1), '')
    || CASE WHEN (SELECT COUNT(*) FROM SalgsordreLinjer x WHERE x.so_id=${a}.id) > 1
            THEN ' +' || ((SELECT COUNT(*) FROM SalgsordreLinjer x WHERE x.so_id=${a}.id) - 1) ELSE '' END AS salttype,
  COALESCE((SELECT p.fargekode FROM SalgsordreLinjer x JOIN Produkter p ON p.id=x.produkt_id WHERE x.so_id=${a}.id ORDER BY x.id LIMIT 1), '#7a857f') AS fargekode`;

const PRODUKTER_SQL = `SELECT * FROM Produkter WHERE aktiv=1 ORDER BY CASE type WHEN 'Bulk' THEN 1 WHEN 'Bigbag' THEN 2 ELSE 3 END, navn`;

/** Utleverte tonn (ferdige ordrer) pr. dag og pr. periode – ekte tall fra Salgsordrer.ferdig_tidspunkt. */
app.get('/api/dashboard', async (c) => {
  const varer = (await c.env.DB.prepare(PRODUKTER_SQL).all()).results as any[];
  const sum = (t: string) => varer.filter((v) => v.type === t).reduce((x, v) => x + v.lager, 0);
  const { results: ferdige } = await c.env.DB.prepare(
    "SELECT ferdig_tidspunkt, tonn FROM Salgsordrer WHERE status='Ferdig' AND ferdig_tidspunkt >= ?",
  ).bind(new Date(Date.now() - 366 * 86400000).toISOString()).all<{ ferdig_tidspunkt: string; tonn: number }>();
  const dag = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const perDag = new Map<string, number>();
  for (const f of ferdige) perDag.set(dag(f.ferdig_tidspunkt), (perDag.get(dag(f.ferdig_tidspunkt)) ?? 0) + f.tonn);
  const utlevertPerDag = Array.from({ length: 30 }, (_, i) => {
    const d = dag(new Date(Date.now() - (29 - i) * 86400000).toISOString());
    return { dato: d, tonn: Math.round((perDag.get(d) ?? 0) * 10) / 10 };
  });
  const perioder = [1, 3, 7, 30, 90, 365].map((dager) => {
    const fra = dag(new Date(Date.now() - (dager - 1) * 86400000).toISOString());
    let tonn = 0;
    for (const [d, t] of perDag) if (d >= fra) tonn += t;
    return { dager, tonn: Math.round(tonn * 10) / 10 };
  });
  const totalt = { tonn_bulk: sum('Bulk'), antall_bigbags: sum('Bigbag'), antall_paller: sum('Pall') };
  return c.json({ varer, totalt, perioder, utlevertPerDag });
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
         s.ordrenummer, s.kunde, s.tonn, s.frist, ${soKol('s')}
  FROM BatLasteplan l
  JOIN Salgsordrer s ON s.id=l.so_id`;

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
    `SELECT l.id, l.batanlop_id, l.so_id, l.status, s.tonn
     FROM BatLasteplan l JOIN Salgsordrer s ON s.id=l.so_id WHERE l.id=?`,
  ).bind(stegId).first<any>();
  if (!steg) return c.json({ error: 'Ikke funnet' }, 404);
  if (steg.status === 'Ferdig') return c.json({ ok: true });

  const neste = await db
    .prepare("SELECT id, so_id FROM BatLasteplan WHERE batanlop_id=? AND status='Venter' AND id!=? ORDER BY rekkefolge_nummer LIMIT 1")
    .bind(steg.batanlop_id, stegId).first<{ id: number; so_id: number }>();
  const stmts = [
    db.prepare("UPDATE BatLasteplan SET status='Ferdig', ferdig_tidspunkt=? WHERE id=?").bind(now(), stegId),
    db.prepare("UPDATE Salgsordrer SET status='Ferdig', ferdig_tidspunkt=? WHERE id=?").bind(now(), steg.so_id),
    trekkFraLager(db, steg.so_id),
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

/** Trekker ordrelinjene fra lagerbeholdningen (bulk i tonn, bigbags/paller i antall). */
const trekkFraLager = (db: D1Database, soId: number) =>
  db.prepare(
    `UPDATE Produkter SET lager = MAX(0, lager - COALESCE((SELECT SUM(antall) FROM SalgsordreLinjer WHERE so_id=?1 AND produkt_id=Produkter.id), 0))
     WHERE id IN (SELECT produkt_id FROM SalgsordreLinjer WHERE so_id=?1)`,
  ).bind(soId);

/** Ferdig lastet båt får en kaibok-føring automatisk (mannskapet fyller inn tilbakemelding etterpå). */
async function opprettKaibokFraAnlop(db: D1Database, batanlopId: number) {
  const bat = await db.prepare('SELECT skipsnavn, mmsi FROM Batanlop WHERE id=?').bind(batanlopId).first<{ skipsnavn: string; mmsi: string | null }>();
  if (!bat) return;
  const { results } = await db.prepare(
    `SELECT pr.type AS emballasje, SUM(l.antall*pr.kg_per_enhet)/1000.0 AS tonn FROM BatLasteplan p
     JOIN SalgsordreLinjer l ON l.so_id=p.so_id JOIN Produkter pr ON pr.id=l.produkt_id WHERE p.batanlop_id=? GROUP BY pr.type`,
  ).bind(batanlopId).all<{ emballasje: string; tonn: number }>();
  const bulk = results.some((r) => r.emballasje === 'Bulk');
  const pall = results.some((r) => r.emballasje !== 'Bulk');
  const r = await db.prepare(
    `INSERT OR IGNORE INTO Kaibok (batanlop_id, baatnavn, mmsi, kai_dato, operasjon, varetype, tonn, opprettet, lager_fort)
     VALUES (?,?,?,?,?,?,?,?,0)`,
  ).bind(batanlopId, bat.skipsnavn, bat.mmsi, new Date().toISOString().slice(0, 10), 'Lasting',
    bulk && pall ? 'Begge' : pall ? 'Pallevarer' : 'Bulk', results.reduce((s, r) => s + r.tonn, 0), now()).run();
  // Produktene som ble lastet (lageret er allerede trukket ved ferdigmelding – derfor lager_fort = 0)
  if (r.meta.changes) {
    await db.prepare(
      `INSERT INTO KaibokLinjer (foering_id, produkt_id, antall)
       SELECT ?1, l.produkt_id, SUM(l.antall) FROM BatLasteplan p JOIN SalgsordreLinjer l ON l.so_id=p.so_id
       WHERE p.batanlop_id=?2 GROUP BY l.produkt_id`,
    ).bind(r.meta.last_row_id, batanlopId).run();
  }
}

type Linje = { so_id: number; [k: string]: unknown };

/** Legger SO-linjene (bulk / bigbag / pall) på hver rad. `key` er kolonnen som peker til SO-id. */
async function medLinjer<T extends Record<string, any>>(db: D1Database, rader: T[], key: 'id' | 'so_id'): Promise<(T & { linjer: Linje[] })[]> {
  if (rader.length === 0) return [];
  const ids = [...new Set(rader.map((r) => r[key] as number))];
  const { results } = await db
    .prepare(
      `SELECT l.id, l.so_id, l.produkt_id, l.antall, p.produktnr, p.navn AS produkt, p.navn AS salttype, p.type AS emballasje,
              p.enhet, p.kg_per_enhet, p.pallertype, p.fargekode
       FROM SalgsordreLinjer l JOIN Produkter p ON p.id=l.produkt_id
       WHERE l.so_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.id`,
    )
    .bind(...ids)
    .all<Linje>();
  return rader.map((r) => ({ ...r, linjer: results.filter((l) => l.so_id === r[key]) }));
}

// ---------- Salgsordrer ----------

const SO_SQL = `SELECT s.*, ${soKol('s')} FROM Salgsordrer s`;

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

type NyLinje = { produkt_id: number; antall: number };

/** Opprett SO fra produktlinjer (SKU + antall). Tonn beregnes fra produktenes vekt. */
app.post('/api/salgsordrer', async (c) => {
  const b = await c.req.json<{ ordrenummer: string; kunde: string; frist: string; linjer?: NyLinje[] }>();
  const linjer = b.linjer ?? [];
  if (!b.ordrenummer?.trim() || !b.kunde?.trim() || !b.frist || linjer.length === 0) return c.json({ error: 'Ordrenummer, kunde, frist og minst én produktlinje kreves' }, 400);
  if (linjer.some((l) => !(l.antall > 0))) return c.json({ error: 'Antall må være større enn 0' }, 400);
  const ids = [...new Set(linjer.map((l) => l.produkt_id))];
  const { results: prod } = await c.env.DB.prepare(`SELECT id, kg_per_enhet FROM Produkter WHERE aktiv=1 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: number; kg_per_enhet: number }>();
  if (prod.length !== ids.length) return c.json({ error: 'Ukjent eller deaktivert produkt i ordren' }, 400);
  const kg = new Map(prod.map((p) => [p.id, p.kg_per_enhet]));
  const tonn = linjer.reduce((sum, l) => sum + (l.antall * kg.get(l.produkt_id)!) / 1000, 0);
  const finnes = await c.env.DB.prepare('SELECT id FROM Salgsordrer WHERE ordrenummer=?').bind(b.ordrenummer.trim()).first();
  if (finnes) return c.json({ error: `Ordrenummer ${b.ordrenummer.trim()} finnes allerede` }, 409);
  const r = await c.env.DB.prepare('INSERT INTO Salgsordrer (ordrenummer, kunde, tonn, frist) VALUES (?,?,?,?)')
    .bind(b.ordrenummer.trim(), b.kunde.trim(), tonn, b.frist).run();
  const id = r.meta.last_row_id;
  await c.env.DB.batch(linjer.map((l) => c.env.DB.prepare('INSERT INTO SalgsordreLinjer (so_id, produkt_id, antall) VALUES (?,?,?)').bind(id, l.produkt_id, l.antall)));
  return c.json({ id }, 201);
});

app.patch('/api/salgsordrer/:id', async (c) => {
  const id = +c.req.param('id');
  const b = await c.req.json<{ kunde?: string; frist?: string; status?: string }>();
  await c.env.DB.prepare(
    `UPDATE Salgsordrer SET kunde=COALESCE(?,kunde), frist=COALESCE(?,frist), status=COALESCE(?,status) WHERE id=?`,
  ).bind(b.kunde ?? null, b.frist ?? null, b.status ?? null, id).run();
  return c.json({ ok: true });
});

app.delete('/api/salgsordrer/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM Salgsordrer WHERE id=?').bind(+c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Lastebil-ordre ferdig (fjernes fra køen, trekkes fra lager). */
app.post('/api/salgsordrer/:id/ferdig', async (c) => {
  const id = +c.req.param('id');
  const so = await c.env.DB.prepare('SELECT status FROM Salgsordrer WHERE id=?').bind(id).first<any>();
  if (!so) return c.json({ error: 'Ikke funnet' }, 404);
  if (so.status !== 'Ferdig') {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE Salgsordrer SET status='Ferdig', ferdig_tidspunkt=? WHERE id=?").bind(now(), id),
      trekkFraLager(c.env.DB, id),
    ]);
  }
  return c.json({ ok: true });
});

// ---------- Sjåfør / Kjøre-modus ----------

/** Alt mobilappen trenger i ett kall. Båt-modus overstyrer alt annet. */
app.get('/api/sjafor', async (c) => {
  const db = c.env.DB;
  const bat = await db.prepare(`${BAT_SQL} WHERE b.status='Lasting' ORDER BY b.eta LIMIT 1`).first<any>();
  const varer = (await db.prepare(PRODUKTER_SQL).all()).results;
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

/** Nøkkelen klienten bruker for en flåtebåt: MMSI, eller «IMO…» inntil MMSI er funnet i AIS. */
const noekkel = (r: { mmsi: string | null; imo: string | null }) => r.mmsi ?? `IMO${r.imo}`;

/** Brukerens flåte med siste kjente posisjon. Båter lagt til med bare IMO kobles automatisk når de dukker opp i AIS. */
app.get('/api/flate', async (c) => {
  const { bruker } = await hentBruker(c);
  const db = c.env.DB;
  let rader = (await db.prepare('SELECT id, mmsi, imo, navn FROM Flate WHERE bruker_id=? ORDER BY lagt_til, navn').bind(bruker.id).all<{ id: number; mmsi: string | null; imo: string | null; navn: string }>()).results;
  let feil: string | null = null;

  // 1) Koble IMO-båter til MMSI når de er innenfor AIS-dekning
  const ventende = rader.filter((r) => !r.mmsi && r.imo);
  if (ventende.length) {
    try {
      const funnet = await finnPaaImo(c.env, ventende.map((r) => r.imo!), caches.default);
      const stmts: D1PreparedStatement[] = [];
      for (const r of ventende) {
        const f = funnet.get(r.imo!);
        if (!f) continue;
        if (rader.some((x) => x.mmsi === f.mmsi)) { stmts.push(db.prepare('DELETE FROM Flate WHERE id=?').bind(r.id)); continue; } // finnes allerede med MMSI
        const generisk = r.navn.startsWith('IMO ');
        stmts.push(
          db.prepare('UPDATE Flate SET mmsi=?, navn=? WHERE id=?').bind(f.mmsi, generisk ? f.navn : r.navn, r.id),
          // Kontaktinfo/bilder som ble lagt inn på IMO-nøkkelen flyttes til MMSI
          db.prepare('UPDATE OR IGNORE FartoyInfo SET mmsi=? WHERE mmsi=?').bind(f.mmsi, `IMO${r.imo}`),
          db.prepare('UPDATE FartoyBilde SET mmsi=? WHERE mmsi=?').bind(f.mmsi, `IMO${r.imo}`),
        );
      }
      if (stmts.length) {
        await db.batch(stmts);
        rader = (await db.prepare('SELECT id, mmsi, imo, navn FROM Flate WHERE bruker_id=? ORDER BY lagt_til, navn').bind(bruker.id).all<any>()).results;
      }
    } catch (e) { feil = (e as Error).message; }
  }

  // 2) Posisjoner for båtene som har MMSI
  let posisjoner = new Map<string, any>();
  try {
    posisjoner = await sistePosisjoner(c.env, rader.filter((r) => r.mmsi).map((r) => r.mmsi!));
  } catch (e) {
    feil ??= (e as Error).message;
  }
  return c.json({
    kilde: kilde(c.env), feil,
    fartoy: rader.map((r) => {
      const posisjon = r.mmsi ? posisjoner.get(r.mmsi) ?? null : null;
      return { id: r.id, mmsi: r.mmsi, imo: r.imo, noekkel: noekkel(r), navn: r.navn, posisjon, venter: !r.mmsi };
    }),
  });
});

/** Legg til båt med MMSI og/eller IMO. Med bare IMO vises den på kartet først når den er innenfor AIS-dekning. */
app.post('/api/flate', async (c) => {
  const { bruker } = await hentBruker(c);
  const b = await c.req.json<{ mmsi?: string; imo?: string; navn?: string }>();
  const mmsi = b.mmsi?.trim() || null;
  const imo = b.imo?.trim().replace(/^IMO\s*/i, '') || null;
  if (!mmsi && !imo) return c.json({ error: 'Oppgi MMSI eller IMO-nummer' }, 400);
  if (mmsi && !/^\d{9}$/.test(mmsi)) return c.json({ error: 'MMSI må være 9 siffer' }, 400);
  if (imo && !gyldigImo(imo)) return c.json({ error: 'Ugyldig IMO-nummer (7 siffer med riktig kontrollsiffer)' }, 400);
  let navn = (b.navn ?? '').trim();
  let mmsiFunnet = mmsi;
  // Har vi bare IMO: se om båten allerede er innenfor AIS-dekning
  if (!mmsi && imo) {
    const f = (await finnPaaImo(c.env, [imo], caches.default).catch(() => new Map())).get(imo);
    if (f) { mmsiFunnet = f.mmsi; navn ||= f.navn; }
  }
  const dublett = await c.env.DB.prepare('SELECT id FROM Flate WHERE bruker_id=? AND ((mmsi IS NOT NULL AND mmsi=?) OR (imo IS NOT NULL AND imo=?))').bind(bruker.id, mmsiFunnet, imo).first();
  if (dublett) return c.json({ ok: true, alleredeIFlaaten: true });
  await c.env.DB.prepare('INSERT INTO Flate (bruker_id, mmsi, imo, navn, lagt_til) VALUES (?,?,?,?,?)')
    .bind(bruker.id, mmsiFunnet, imo, navn || (imo ? `IMO ${imo}` : `MMSI ${mmsi}`), now()).run();
  return c.json({ ok: true, iAis: !!mmsiFunnet }, 201);
});

app.delete('/api/flate/:noekkel', async (c) => {
  const { bruker } = await hentBruker(c);
  const n = c.req.param('noekkel');
  await c.env.DB.prepare('DELETE FROM Flate WHERE bruker_id=? AND (mmsi=? OR (mmsi IS NULL AND imo=?))').bind(bruker.id, n, n.replace(/^IMO/, '')).run();
  return c.json({ ok: true });
});

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
produktRoutes(app);
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
