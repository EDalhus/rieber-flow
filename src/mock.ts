// Simulerte AIS-posisjoner langs norskekysten. Brukes kun når Barentswatch-nøkler ikke er satt,
// slik at kartet kan demonstreres uten konto. Posisjonene er deterministiske funksjoner av klokka.
import type { Pos } from './ais';

type Rute = [number, number][];

const SOR_NORD: Rute = [[58.0, 7.0], [58.9, 5.4], [60.4, 4.7], [62.4, 5.3], [63.6, 7.9], [65.0, 10.3], [66.6, 12.2], [67.6, 13.9], [69.0, 16.5], [70.4, 20.0], [70.9, 25.0]];
const OSLOFJORD: Rute = [[59.0, 10.4], [58.6, 9.9], [58.0, 8.6], [57.9, 7.0], [58.6, 5.6], [60.2, 4.9]];
const NORDLAND: Rute = [[67.28, 13.6], [67.9, 13.6], [68.6, 14.6], [69.3, 16.3], [69.9, 18.7]];
const MIDT: Rute = [[62.6, 5.6], [63.2, 7.0], [63.7, 8.9], [64.4, 9.9], [65.0, 10.6]];

export type MockFartoy = { mmsi: string; imo: string; navn: string; rute: Rute; periodeTimer: number; forskyvning: number; destinasjon: string; skipstype: number; sog: number };

export const KATALOG: MockFartoy[] = [
  { mmsi: '257123400', imo: '9100001', navn: 'MV NORDIC STAR', rute: MIDT, periodeTimer: 9, forskyvning: 0.1, destinasjon: 'NOKRS', skipstype: 70, sog: 11 },
  { mmsi: '219456700', imo: '9100002', navn: 'MS BALTIC TRADER', rute: OSLOFJORD, periodeTimer: 14, forskyvning: 0.55, destinasjon: 'NOOSL', skipstype: 70, sog: 12 },
  { mmsi: '258987600', imo: '9100003', navn: 'MV ARCTIC BREEZE', rute: SOR_NORD, periodeTimer: 60, forskyvning: 0.3, destinasjon: 'NOHFT', skipstype: 70, sog: 13 },
  { mmsi: '257555100', imo: '9100004', navn: 'MV SALT CARRIER', rute: NORDLAND, periodeTimer: 10, forskyvning: 0.8, destinasjon: 'NOBOO', skipstype: 70, sog: 9 },
  { mmsi: '257600001', imo: '9100005', navn: 'MS KYSTLINJE', rute: SOR_NORD, periodeTimer: 70, forskyvning: 0.75, destinasjon: 'NOTOS', skipstype: 60, sog: 15 },
  { mmsi: '257600002', imo: '9100006', navn: 'MV FJORDBULK', rute: OSLOFJORD, periodeTimer: 16, forskyvning: 0.2, destinasjon: 'NOKRS', skipstype: 70, sog: 10 },
  { mmsi: '257600003', imo: '9100007', navn: 'MS NORDLYS EXPRESS', rute: NORDLAND, periodeTimer: 12, forskyvning: 0.4, destinasjon: 'NOTOS', skipstype: 60, sog: 17 },
  { mmsi: '257600004', imo: '9100008', navn: 'MV HAVBRIS', rute: MIDT, periodeTimer: 8, forskyvning: 0.9, destinasjon: 'NOTRD', skipstype: 70, sog: 10 },
];

const bearing = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};

/** Posisjon langs ruta (fram og tilbake) på gitt tidspunkt. */
export function mockPos(f: MockFartoy, tid: number): Pos {
  const { rute } = f;
  const fase = (((tid / 3600000 / f.periodeTimer + f.forskyvning) % 1) + 1) % 1; // 0..1
  const t = fase < 0.5 ? fase * 2 : (1 - fase) * 2; // fram og tilbake
  const seg = t * (rute.length - 1);
  const i = Math.min(rute.length - 2, Math.floor(seg));
  const u = seg - i;
  const a = rute[i], b = rute[i + 1];
  const retning = fase < 0.5 ? bearing(a, b) : bearing(b, a);
  return {
    mmsi: f.mmsi, imo: f.imo, navn: f.navn,
    lat: a[0] + (b[0] - a[0]) * u, lon: a[1] + (b[1] - a[1]) * u,
    sog: f.sog, cog: retning, heading: retning, navstatus: 0, skipstype: f.skipstype,
    destinasjon: f.destinasjon, eta: null, msgtime: new Date(tid).toISOString(),
    stevning: Math.round(retning), rot: 0,
    kallesignal: `LA${f.mmsi.slice(-3)}X`, lengde: 110 + (Number(f.mmsi.slice(-2)) % 40), bredde: 18, dypgang: 6.4, flagg: 'NO',
  };
}

export const mockSiste = (mmsi: string, tid = Date.now()) => {
  const f = KATALOG.find((k) => k.mmsi === mmsi);
  return f ? mockPos(f, tid) : null;
};

export const mockSpor = (mmsi: string) => {
  const f = KATALOG.find((k) => k.mmsi === mmsi);
  if (!f) return [];
  const naa = Date.now();
  return Array.from({ length: 49 }, (_, n) => mockPos(f, naa - (48 - n) * 30 * 60000)).map((p) => ({ lat: p.lat, lon: p.lon, msgtime: p.msgtime }));
};
