import type { Context } from 'hono';
import type { Env } from './types';

export const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export type Bruker = { id: number; epost: string; navn: string; rolle: string };

/**
 * Cloudflare Access setter Cf-Access-Authenticated-User-Email (ekte innlogging).
 * Uten Access brukes X-Demo-User (kun for demo – kan forfalskes) eller første bruker.
 */
export async function hentBruker(c: Context<Env>) {
  const db = c.env.DB;
  const access = c.req.header('Cf-Access-Authenticated-User-Email')?.toLowerCase();
  const epost = access ?? c.req.header('X-Demo-User')?.toLowerCase();
  let u = epost ? await db.prepare('SELECT * FROM Brukere WHERE epost=?').bind(epost).first<Bruker>() : null;
  if (!u && access) {
    await db.prepare('INSERT INTO Brukere (epost, navn) VALUES (?,?)').bind(access, access.split('@')[0]).run();
    u = await db.prepare('SELECT * FROM Brukere WHERE epost=?').bind(access).first<Bruker>();
  }
  u ??= await db.prepare('SELECT * FROM Brukere ORDER BY id LIMIT 1').first<Bruker>();
  return { bruker: u!, demo: !access };
}

