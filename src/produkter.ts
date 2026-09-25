import type { Hono } from 'hono';
import type { Env } from './types';
import { hentBruker, now } from './bruker';

const TYPER = ['Bulk', 'Bigbag', 'Pall'];
const PALLETYPER = ['Europalle', 'SRS plastpalle'];
/** Roller som kan administrere produktkatalogen (sjåfører og lager kan bare lese). */
const ADMIN_ROLLER = ['Formann', 'Kontor', 'Ledelse'];

type ProduktInn = {
  produktnr?: string; navn?: string; beskrivelse?: string; type?: string; enhet?: string; kg_per_enhet?: number;
  fargekode?: string; lager?: number; aktiv?: boolean | number; pallertype?: string | null;
};

function valider(b: ProduktInn): string | null {
  if (!b.produktnr?.trim()) return 'Produkt-ID/nummer kreves';
  if (b.produktnr.trim().length > 40) return 'Produkt-ID er for lang (maks 40 tegn)';
  if (!b.navn?.trim()) return 'Navn kreves';
  if (b.navn.trim().length > 120) return 'Navnet er for langt';
  if ((b.beskrivelse ?? '').length > 600) return 'Beskrivelsen er for lang (maks 600 tegn)';
  if (!TYPER.includes(b.type ?? '')) return 'Type må være Bulk, Bigbag eller Pall';
  if (b.type === 'Pall' && !PALLETYPER.includes(b.pallertype ?? '')) return 'Velg pallertype: Europalle eller SRS plastpalle';
  if (b.type !== 'Bulk' && !(Number(b.kg_per_enhet) > 0)) return 'Vekt pr. enhet (kg) må være større enn 0';
  if (b.type !== 'Bulk' && !b.enhet?.trim()) return 'Enhet/pakking kreves (f.eks. «1000 kg» eller «40 × 25 kg»)';
  if (!/^#[0-9a-fA-F]{6}$/.test(b.fargekode ?? '')) return 'Ugyldig fargekode';
  if (b.lager != null && !(Number(b.lager) >= 0)) return 'Lager kan ikke være negativt';
  return null;
}

/** Bulk måles alltid i tonn (1000 kg pr. enhet); bigbag/pall bruker oppgitt vekt og pakking. */
const normaliser = (b: ProduktInn) => ({
  produktnr: b.produktnr!.trim(), navn: b.navn!.trim(), beskrivelse: (b.beskrivelse ?? '').trim(), type: b.type!,
  enhet: b.type === 'Bulk' ? 'tonn' : b.enhet!.trim(),
  kg_per_enhet: b.type === 'Bulk' ? 1000 : Number(b.kg_per_enhet),
  pallertype: b.type === 'Pall' ? b.pallertype! : null,
  fargekode: b.fargekode!.toUpperCase(), lager: Number(b.lager ?? 0),
});

export function produktRoutes(app: Hono<Env>) {
  /** Aktive produkter (til ordreskjema o.l.) – åpent for alle innloggede. */
  app.get('/api/produkter', async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM Produkter WHERE aktiv=1 ORDER BY CASE type WHEN 'Bulk' THEN 1 WHEN 'Bigbag' THEN 2 ELSE 3 END, navn",
    ).all();
    return c.json(results);
  });

  /** Alle produkter (også deaktiverte) med bruk, for Admin-siden. */
  app.get('/api/admin/produkter', async (c) => {
    const { bruker } = await hentBruker(c);
    const { results } = await c.env.DB.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM SalgsordreLinjer l WHERE l.produkt_id = p.id) AS antall_linjer
       FROM Produkter p ORDER BY CASE p.type WHEN 'Bulk' THEN 1 WHEN 'Bigbag' THEN 2 ELSE 3 END, p.navn`,
    ).all();
    return c.json({ kanEndre: ADMIN_ROLLER.includes(bruker.rolle), produkter: results });
  });

  const krevAdmin = async (c: any) => {
    const { bruker } = await hentBruker(c);
    return ADMIN_ROLLER.includes(bruker.rolle) ? null : c.json({ error: `Rollen «${bruker.rolle}» kan ikke endre produktkatalogen` }, 403);
  };

  app.post('/api/admin/produkter', async (c) => {
    const nei = await krevAdmin(c);
    if (nei) return nei;
    const b = await c.req.json<ProduktInn>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const n = normaliser(b);
    const finnes = await c.env.DB.prepare('SELECT id FROM Produkter WHERE produktnr = ?').bind(n.produktnr).first();
    if (finnes) return c.json({ error: `Produkt-ID «${n.produktnr}» er allerede i bruk` }, 409);
    const r = await c.env.DB.prepare(
      `INSERT INTO Produkter (produktnr, navn, beskrivelse, type, enhet, kg_per_enhet, pallertype, fargekode, lager, opprettet) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(n.produktnr, n.navn, n.beskrivelse, n.type, n.enhet, n.kg_per_enhet, n.pallertype, n.fargekode, n.lager, now()).run();
    return c.json({ id: r.meta.last_row_id }, 201);
  });

  app.put('/api/admin/produkter/:id', async (c) => {
    const nei = await krevAdmin(c);
    if (nei) return nei;
    const id = +c.req.param('id');
    const b = await c.req.json<ProduktInn>();
    const feil = valider(b);
    if (feil) return c.json({ error: feil }, 400);
    const n = normaliser(b);
    const gammel = await c.env.DB.prepare(
      'SELECT type, kg_per_enhet, (SELECT COUNT(*) FROM SalgsordreLinjer WHERE produkt_id = ?1) AS n FROM Produkter WHERE id = ?1',
    ).bind(id).first<{ type: string; kg_per_enhet: number; n: number }>();
    if (!gammel) return c.json({ error: 'Ikke funnet' }, 404);
    if (gammel.n > 0 && (gammel.type !== n.type || gammel.kg_per_enhet !== n.kg_per_enhet)) {
      return c.json({ error: `Produktet brukes i ${gammel.n} ordrelinje(r) – type og vekt kan ikke endres. Opprett et nytt produkt i stedet.` }, 409);
    }
    const dublett = await c.env.DB.prepare('SELECT id FROM Produkter WHERE produktnr = ? AND id != ?').bind(n.produktnr, id).first();
    if (dublett) return c.json({ error: `Produkt-ID «${n.produktnr}» er allerede i bruk` }, 409);
    await c.env.DB.prepare(
      `UPDATE Produkter SET produktnr=?, navn=?, beskrivelse=?, type=?, enhet=?, kg_per_enhet=?, pallertype=?, fargekode=?, lager=?, aktiv=? WHERE id=?`,
    ).bind(n.produktnr, n.navn, n.beskrivelse, n.type, n.enhet, n.kg_per_enhet, n.pallertype, n.fargekode, n.lager, b.aktiv === false || b.aktiv === 0 ? 0 : 1, id).run();
    return c.json({ ok: true });
  });

  app.delete('/api/admin/produkter/:id', async (c) => {
    const nei = await krevAdmin(c);
    if (nei) return nei;
    const id = +c.req.param('id');
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM SalgsordreLinjer WHERE produkt_id = ?').bind(id).first<{ n: number }>();
    if ((n?.n ?? 0) > 0) return c.json({ error: `Produktet brukes i ${n!.n} ordrelinje(r) og kan ikke slettes – deaktiver det i stedet.` }, 409);
    await c.env.DB.prepare('DELETE FROM Produkter WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });
}
