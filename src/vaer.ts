import type { Hono } from 'hono';
import type { Env } from './types';

// MET Norway (api.met.no). Vilkår: identifiserende User-Agent, ikke hamre API-et – vi cacher i 10 min.
const UA = 'Flow-terminal/1.0 github.com/EDalhus/rieber-flow';
const TERMINAL = { lat: 62.479, lon: 6.193 };
const HAV = { lat: 62.5, lon: 5.5 }; // åpent hav utenfor Ålesund (Breisundet/Storegga-siden)

async function met(url: string, cache: Cache): Promise<any> {
  const nokkel = new Request(url);
  const treff = await cache.match(nokkel);
  if (treff) return treff.json();
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`MET svarte ${r.status}`);
  const tekst = await r.text();
  await cache.put(nokkel, new Response(tekst, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } }));
  return JSON.parse(tekst);
}

/** Vær og bølger ved terminalen (kort prognose for de neste timene). */
export function vaerRoutes(app: Hono<Env>) {
  app.get('/api/vaer', async (c) => {
    const cache = caches.default;
    try {
      const [vaer, hav] = await Promise.all([
        met(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${TERMINAL.lat}&lon=${TERMINAL.lon}`, cache),
        met(`https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=${HAV.lat}&lon=${HAV.lon}`, cache).catch(() => null),
      ]);
      const fraNa = (ts: any[]) => {
        const grense = Date.now() - 3600000;
        const i = ts.findIndex((t) => Date.parse(t.time) >= grense);
        return ts.slice(Math.max(0, i), Math.max(0, i) + 9);
      };
      const timer = fraNa(vaer.properties.timeseries).map((t: any) => ({
        tid: t.time,
        temp: t.data.instant.details.air_temperature,
        vind: t.data.instant.details.wind_speed,
        retning: t.data.instant.details.wind_from_direction,
        symbol: (t.data.next_1_hours ?? t.data.next_6_hours)?.summary?.symbol_code ?? null,
        nedbor: (t.data.next_1_hours ?? t.data.next_6_hours)?.details?.precipitation_amount ?? 0,
      }));
      const bolger = hav ? fraNa(hav.properties.timeseries).map((t: any) => ({
        tid: t.time, hoyde: t.data.instant.details.sea_surface_wave_height, retning: t.data.instant.details.sea_surface_wave_from_direction,
      })) : [];
      return c.json({
        oppdatert: vaer.properties.meta.updated_at,
        na: timer[0], timer,
        hav: bolger[0] ? { na: bolger[0], timer: bolger, temp: hav.properties.timeseries[0]?.data.instant.details.sea_water_temperature ?? null } : null,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
}
