// Bygger src/generated/sql.ts fra db/*.sql, slik at Worker kan sette opp D1 selv.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const split = (file) =>
  readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);

mkdirSync(new URL('../src/generated', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../src/generated/sql.ts', import.meta.url),
  `// AUTO-GENERERT av scripts/gen-sql.mjs – ikke rediger. Kilde: db/schema.sql, db/seed.sql\n` +
    `export const SCHEMA: string[] = ${JSON.stringify(split('schema.sql'), null, 2)};\n` +
    `export const SEED: string[] = ${JSON.stringify(split('seed.sql'), null, 2)};\n`,
);
console.log('src/generated/sql.ts skrevet');
