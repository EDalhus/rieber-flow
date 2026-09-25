import { SCHEMA, SEED } from './generated/sql';

let ready: Promise<void> | null = null;

/** Oppretter schema + mock-data hvis databasen er tom eller har eldre schema (demo-data, trygt å bygge på nytt). */
export function ensureDb(db: D1Database): Promise<void> {
  ready ??= (async () => {
    // Sjekk nyeste tabell – mangler den, er databasen laget av en eldre schema-versjon
    const t = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='FartoyInfo'").first();
    if (!t) await resetDb(db);
    await fjernDemoBater(db);
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
