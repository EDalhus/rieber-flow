import { SCHEMA, SEED } from './generated/sql';

let ready: Promise<void> | null = null;

/** Oppretter schema + mock-data hvis databasen er tom (første kall etter deploy). */
export function ensureDb(db: D1Database): Promise<void> {
  ready ??= (async () => {
    const t = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Varelager'").first();
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
