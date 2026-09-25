import { MIGRER, SCHEMA, SEED } from './generated/sql';

let ready: Promise<void> | null = null;

/** Oppretter schema + mock-data hvis databasen er tom eller har eldre schema (demo-data, trygt å bygge på nytt). */
export function ensureDb(db: D1Database): Promise<void> {
  ready ??= (async () => {
    // Sjekk nyeste tabell – mangler den, er databasen laget av en eldre schema-versjon
    const t = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='FartoyInfo'").first();
    if (!t) await resetDb(db);
    // Databaser fra før produktkatalogen: migrer (bevarer brukerdata som flåte, kaibok og egne anløp)
    else if (!(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Produkter'").first())) {
      await db.batch(MIGRER.map((q) => db.prepare(q)));
    }
    await fjernDemoBater(db);
    await oppdaterOgRydd(db);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export async function resetDb(db: D1Database): Promise<void> {
  await db.batch([...SCHEMA, ...SEED].map((s) => db.prepare(s)));
}

// Tidligere demo-/testbåter med plassholder-MMSI. Fjernes fra eksisterende databaser slik at kartet bare viser ekte AIS.
const PLASSHOLDER = ['257123400', '219456700', '258987600', '257555100', '257600001', '257600002', '257600003', '257600004', '257600005'];

async function fjernDemoBater(db: D1Database) {
  const ph = PLASSHOLDER.map(() => '?').join(',');
  await db.batch([
    db.prepare(`DELETE FROM Flate WHERE mmsi IN (${ph})`).bind(...PLASSHOLDER),
    db.prepare(`DELETE FROM FartoyInfo WHERE mmsi IN (${ph})`).bind(...PLASSHOLDER),
    db.prepare(`DELETE FROM FartoyBilde WHERE mmsi IN (${ph})`).bind(...PLASSHOLDER),
    db.prepare(`UPDATE Batanlop SET mmsi = NULL WHERE mmsi IN (${ph})`).bind(...PLASSHOLDER),
    db.prepare(`UPDATE Kaibok SET mmsi = NULL WHERE mmsi IN (${ph})`).bind(...PLASSHOLDER),
  ]);
}

/** Legger til nye kolonner i eksisterende databaser og fjerner demo-data (én gang). */
async function oppdaterOgRydd(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS Oppsett (nokkel TEXT PRIMARY KEY, verdi TEXT NOT NULL)').run();
  if (!(await db.prepare("SELECT 1 AS x FROM pragma_table_info('Salgsordrer') WHERE name='ferdig_tidspunkt'").first())) {
    await db.prepare('ALTER TABLE Salgsordrer ADD COLUMN ferdig_tidspunkt TEXT').run();
  }
  if (!(await db.prepare("SELECT 1 AS x FROM pragma_table_info('Produkter') WHERE name='pallertype'").first())) {
    await db.prepare('ALTER TABLE Produkter ADD COLUMN pallertype TEXT').run();
  }
  if (!(await db.prepare("SELECT 1 AS x FROM pragma_table_info('Kaibok') WHERE name='lager_fort'").first())) {
    await db.prepare('ALTER TABLE Kaibok ADD COLUMN lager_fort INTEGER NOT NULL DEFAULT 1').run();
  }
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS KaibokLinjer (id INTEGER PRIMARY KEY AUTOINCREMENT, foering_id INTEGER NOT NULL REFERENCES Kaibok(id) ON DELETE CASCADE, produkt_id INTEGER NOT NULL REFERENCES Produkter(id), antall REAL NOT NULL CHECK (antall > 0))'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_kaibok_linje ON KaibokLinjer(foering_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_kaibok_linje_produkt ON KaibokLinjer(produkt_id)'),
  ]);
  if (!(await db.prepare("SELECT 1 AS x FROM pragma_table_info('Kaibok') WHERE name='imo'").first())) {
    await db.prepare('ALTER TABLE Kaibok ADD COLUMN imo TEXT').run();
  }
  // Flåte: bygges om så en båt kan ha bare IMO (uten MMSI ennå)
  if (!(await db.prepare("SELECT 1 AS x FROM pragma_table_info('Flate') WHERE name='id'").first())) {
    await db.batch([
      db.prepare('ALTER TABLE Flate RENAME TO Flate_gammel'),
      db.prepare("CREATE TABLE Flate (id INTEGER PRIMARY KEY AUTOINCREMENT, bruker_id INTEGER NOT NULL REFERENCES Brukere(id) ON DELETE CASCADE, mmsi TEXT, imo TEXT, navn TEXT NOT NULL, lagt_til TEXT NOT NULL, CHECK (mmsi IS NOT NULL OR imo IS NOT NULL))"),
      db.prepare('CREATE UNIQUE INDEX idx_flate_mmsi ON Flate(bruker_id, mmsi) WHERE mmsi IS NOT NULL'),
      db.prepare('CREATE UNIQUE INDEX idx_flate_imo ON Flate(bruker_id, imo) WHERE imo IS NOT NULL'),
      db.prepare('INSERT INTO Flate (bruker_id, mmsi, navn, lagt_til) SELECT bruker_id, mmsi, navn, lagt_til FROM Flate_gammel'),
      db.prepare('DROP TABLE Flate_gammel'),
    ]);
  }
  if (await db.prepare("SELECT 1 AS x FROM Oppsett WHERE nokkel='demo-fjernet'").first()) return;
  const soDemo = ['SO-10041', 'SO-10042', 'SO-10043', 'SO-10044', 'SO-10051', 'SO-10052', 'SO-10061', 'SO-10071', 'SO-10072', 'SO-10073', 'SO-10074', 'SO-10075'];
  const brukerDemo = ['kontor@rieber.demo', 'ledelse@rieber.demo', 'ola@rieber.demo', 'tone@rieber.demo', 'per@rieber.demo'];
  await db.batch([
    db.prepare("DELETE FROM Batanlop WHERE skipsnavn IN ('MV Nordic Star', 'MS Baltic Trader', 'MV Arctic Breeze')"),
    db.prepare(`DELETE FROM Salgsordrer WHERE ordrenummer IN (${soDemo.map(() => '?').join(',')})`).bind(...soDemo),
    // Demo-kaibok har ingen oppretter og ingen kobling til anløp; egne føringer har alltid oppretter
    db.prepare('DELETE FROM Kaibok WHERE opprettet_av IS NULL AND batanlop_id IS NULL'),
    db.prepare("DELETE FROM Fravaer WHERE kategori='Ikke overtid' AND tittel='Barnebursdag' AND bruker_id=(SELECT id FROM Brukere WHERE epost='formann@rieber.demo')"),
    db.prepare(`DELETE FROM Brukere WHERE epost IN (${brukerDemo.map(() => '?').join(',')})`).bind(...brukerDemo),
    db.prepare("INSERT OR IGNORE INTO Oppsett (nokkel, verdi) VALUES ('demo-fjernet', '1')"),
  ]);
}
