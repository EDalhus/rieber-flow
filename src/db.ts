import { SCHEMA, SEED } from './generated/sql';

let ready: Promise<void> | null = null;

/** Oppretter schema + mock-data hvis databasen er tom eller har eldre schema (demo-data, trygt å bygge på nytt). */
export function ensureDb(db: D1Database): Promise<void> {
  ready ??= (async () => {
    // Sjekk nyeste tabell – mangler den, er databasen laget av en eldre schema-versjon
    const t = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='SalgsordreLinjer'").first();
    if (!t) await resetDb(db);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export async function resetDb(db: D1Database): Promise<void> {
  await db.batch([...SCHEMA, ...SEED].map((s) => db.prepare(s)));
}
