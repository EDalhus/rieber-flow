// Sjøvei-avstand til terminalen. To forhåndsberegnede felt (scripts/sjovei), begge Dijkstra fra terminalen over sjøceller
// bygd på Kartverkets kartdata (vannflater): A = hele kysten (500 m), B = detaljvindu rundt Ålesund (50 m).
// A er seedet med de nøyaktige B-avstandene, så tallene utenfor vinduet inkluderer sluttetappen inn til terminalen.
export const TERMINAL = { navn: 'Flatholmen havn 81B, Ålesund', lat: 62.47917879, lon: 6.19291566 };

export type Grid = { lat1: number; lon0: number; dlat: number; dlon: number; H: number; W: number; e: number; d: Uint16Array };
export type Sjofelt = { a: Grid; b: Grid };

async function lastGrid(url: string): Promise<Grid> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Fant ikke sjøvei-data');
  let buf = await r.arrayBuffer();
  if (new Uint8Array(buf, 0, 2).join() === '31,139') {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const dv = new DataView(buf);
  return {
    lat1: dv.getFloat32(4, true), lon0: dv.getFloat32(8, true), dlat: dv.getFloat32(12, true), dlon: dv.getFloat32(16, true),
    H: dv.getUint16(20, true), W: dv.getUint16(22, true), e: dv.getUint16(24, true), d: new Uint16Array(buf, 32),
  };
}

let felt: Promise<Sjofelt> | null = null;
export function lastSjovei(): Promise<Sjofelt> {
  felt ??= Promise.all([lastGrid('/sjovei-a.bin.gz'), lastGrid('/sjovei-b.bin.gz')]).then(([a, b]) => ({ a, b })).catch((e) => { felt = null; throw e; });
  return felt;
}

const rad = Math.PI / 180;
/** Avstand i luftlinje (nautiske mil). */
export function luftlinjeNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(a)) * 6371.0088) / 1.852;
}

/** Punkt gitt start, retning (grader) og avstand (nm). */
export function punktFra(lat: number, lon: number, retning: number, nm: number): [number, number] {
  const d = nm / 3440.065, b = retning * rad, la = lat * rad, lo = lon * rad;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return [lat2 / rad, lon2 / rad];
}

const RETN = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
const mellom = (di: number, dj: number): [number, number][] => {
  if (Math.abs(di) === 2) return [[di / 2, 0], [di / 2, dj]];
  if (Math.abs(dj) === 2) return [[0, dj / 2], [di, dj / 2]];
  if (di && dj) return [[di, 0], [0, dj]];
  return [];
};

export type Sjovei = { nm: number; luftlinje: number; sti: [number, number][] };

const cellLat = (g: Grid, i: number) => g.lat1 - (i + 0.5) * g.dlat;
const cellLon = (g: Grid, j: number) => g.lon0 + (j + 0.5) * g.dlon;
const iVindu = (g: Grid, lat: number, lon: number) => lat <= g.lat1 && lat >= g.lat1 - g.H * g.dlat && lon >= g.lon0 && lon <= g.lon0 + g.W * g.dlon;
const erSjo = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.H && j < g.W && g.d[i * g.W + j] > 0;

/** Nærmeste sjøcelle (båter ved kai ligger på «land» i rutenettet). */
function snapp(g: Grid, lat: number, lon: number, maks: number) {
  const i0 = Math.floor((g.lat1 - lat) / g.dlat), j0 = Math.floor((lon - g.lon0) / g.dlon);
  let best = Infinity, bi = -1, bj = -1;
  for (let a = -maks; a <= maks; a++) for (let b = -maks; b <= maks; b++) {
    if (!erSjo(g, i0 + a, j0 + b)) continue;
    const m = luftlinjeNm(lat, lon, cellLat(g, i0 + a), cellLon(g, j0 + b));
    if (m < best) { best = m; bi = i0 + a; bj = j0 + b; }
  }
  return bi < 0 ? null : { i: bi, j: bj, ekstra: best };
}

/** Følger fallet i avstandsfeltet nedover. Stopper når `stopp` slår til, eller ved bunnen. */
function nedstigning(g: Grid, i: number, j: number, ut: [number, number][], stopp?: (lat: number, lon: number) => boolean) {
  for (let n = 0; n < 12000; n++) {
    let bi = -1, bj = -1, bd = g.d[i * g.W + j];
    for (const [di, dj] of RETN) {
      const ni = i + di, nj = j + dj;
      if (!erSjo(g, ni, nj) || g.d[ni * g.W + nj] >= bd) continue;
      if (!mellom(di, dj).every(([a, b]) => erSjo(g, i + a, j + b))) continue;
      bd = g.d[ni * g.W + nj]; bi = ni; bj = nj;
    }
    if (bi < 0) return { i, j, stoppet: false };
    i = bi; j = bj;
    const lat = cellLat(g, i), lon = cellLon(g, j);
    ut.push([lat, lon]);
    if (stopp?.(lat, lon)) return { i, j, stoppet: true };
  }
  return { i, j, stoppet: false };
}

/** Sjøvei fra en posisjon til terminalen, inkl. rute. `null` hvis posisjonen er utenfor kartutsnittet. */
export function sjovei(f: Sjofelt, lat: number, lon: number): Sjovei | null {
  const { a, b } = f;
  const punkter: [number, number][] = [[lat, lon]];
  let nm: number | null = null;

  if (iVindu(b, lat, lon)) {
    const s = snapp(b, lat, lon, 20);
    if (s) { nm = (b.d[s.i * b.W + s.j] - 1) / b.e + s.ekstra; nedstigning(b, s.i, s.j, punkter); }
  }
  if (nm === null) {
    const s = snapp(a, lat, lon, 10);
    if (!s) return null;
    nm = (a.d[s.i * a.W + s.j] - 1) / a.e + s.ekstra;
    // Grovt felt (A) til vi er inne i detaljvinduet, deretter finfeltet (B) resten av veien
    const r = nedstigning(a, s.i, s.j, punkter, (la, lo) => iVindu(b, la, lo));
    if (r.stoppet) {
      const [pl, po] = punkter[punkter.length - 1];
      const sb = snapp(b, pl, po, 30);
      if (sb) nedstigning(b, sb.i, sb.j, punkter);
    }
  }
  punkter.push([TERMINAL.lat, TERMINAL.lon]);
  const land = (la: number, lo: number) => {
    const g = iVindu(b, la, lo) ? b : a;
    const i = Math.floor((g.lat1 - la) / g.dlat), j = Math.floor((lo - g.lon0) / g.dlon);
    return i >= 0 && j >= 0 && i < g.H && j < g.W && g.d[i * g.W + j] === 0;
  };
  // Forenkle ruta, men aldri slik at en rett strekning krysser land
  const fri = (p: [number, number], q: [number, number]) => {
    const n = Math.ceil(luftlinjeNm(p[0], p[1], q[0], q[1]) / (iVindu(b, p[0], p[1]) ? 0.02 : 0.12));
    for (let k = 2; k < n - 1; k++) if (land(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n)) return false;
    return true;
  };
  return { nm, luftlinje: luftlinjeNm(lat, lon, TERMINAL.lat, TERMINAL.lon), sti: forenkle(punkter, 0.001, fri) };
}

/** Douglas–Peucker (toleranse i grader). */
function forenkle(p: [number, number][], tol: number, fri: (a: [number, number], b: [number, number]) => boolean): [number, number][] {
  if (p.length < 3) return p;
  const k = Math.cos(p[0][0] * rad);
  const avst = (q: [number, number], a: [number, number], b: [number, number]) => {
    const [x, y, x1, y1, x2, y2] = [q[1] * k, q[0], a[1] * k, a[0], b[1] * k, b[0]];
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l)) : 0;
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  let maks = 0, idx = 0;
  for (let n = 1; n < p.length - 1; n++) { const a = avst(p[n], p[0], p[p.length - 1]); if (a > maks) { maks = a; idx = n; } }
  if (maks <= tol && fri(p[0], p[p.length - 1])) return [p[0], p[p.length - 1]];
  if (maks <= tol) idx = p.length >> 1; // korden krysser land: del på midten
  return [...forenkle(p.slice(0, idx + 1), tol, fri).slice(0, -1), ...forenkle(p.slice(idx), tol, fri)];
}

// ---------- Formatering ----------

export const fmtNm = (nm: number) => `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm`.replace('.', ',');

export function fmtVarighet(timer: number) {
  const min = Math.round(timer * 60);
  if (min < 60) return `${min} min`;
  const t = Math.floor(min / 60), m = min % 60;
  if (t >= 48) return `${Math.round(t / 24)} d`;
  return m ? `${t} t ${m} min` : `${t} t`;
}

/** Estimert ankomst til terminalen ved gjeldende fart. */
export function etaTerminal(nm: number, sog: number | null) {
  if (sog == null || sog < 0.5) return null;
  const timer = nm / sog;
  const kl = new Date(Date.now() + timer * 3600000);
  return {
    varighet: fmtVarighet(timer),
    klokka: kl.toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  };
}

const TYPER: [number, number, string][] = [[20, 29, 'Wing in ground'], [30, 30, 'Fiskefartøy'], [31, 32, 'Slepefartøy'], [33, 33, 'Mudderverk'], [34, 34, 'Dykkerfartøy'], [35, 35, 'Militært'], [36, 36, 'Seilbåt'], [37, 37, 'Fritidsbåt'], [40, 49, 'Hurtigbåt'], [50, 50, 'Losbåt'], [51, 51, 'Redningsfartøy'], [52, 52, 'Slepebåt'], [53, 53, 'Havnefartøy'], [55, 55, 'Tollvesen/politi'], [60, 69, 'Passasjerskip'], [70, 79, 'Lasteskip'], [80, 89, 'Tankskip'], [90, 99, 'Annet']];
export const skipstypeTekst = (kode: number | null | undefined) => (kode == null ? null : TYPER.find(([a, b]) => kode >= a && kode <= b)?.[2] ?? `Type ${kode}`);

const NAVSTATUS: Record<number, string> = { 0: 'Går med motor', 1: 'Ankret', 2: 'Ikke under kommando', 3: 'Begrenset manøvreringsevne', 4: 'Begrenset av dypgang', 5: 'Fortøyd', 6: 'Grunnstøtt', 7: 'Driver fiske', 8: 'Går for seil', 15: 'Ikke definert' };
export const navstatusTekst = (k: number | null | undefined) => (k == null ? null : NAVSTATUS[k] ?? `Status ${k}`);

// MMSI-ets tre første siffer (MID) sier hvilket land skipet er registrert i
const MID: Record<string, string> = {
  '257': 'NO', '258': 'NO', '259': 'NO', '219': 'DK', '220': 'DK', '265': 'SE', '266': 'SE', '230': 'FI', '231': 'FO', '232': 'GB', '233': 'GB', '234': 'GB', '235': 'GB',
  '244': 'NL', '245': 'NL', '246': 'NL', '211': 'DE', '218': 'DE', '255': 'PT', '263': 'PT', '224': 'ES', '225': 'ES', '226': 'FR', '227': 'FR', '228': 'FR', '250': 'IE', '251': 'IS',
  '252': 'LI', '261': 'PL', '272': 'UA', '273': 'RU', '275': 'LV', '276': 'EE', '277': 'LT', '205': 'BE', '206': 'BE', '207': 'BG', '209': 'CY', '210': 'CY', '212': 'CY', '215': 'MT',
  '229': 'MT', '248': 'MT', '249': 'MT', '256': 'MT', '238': 'HR', '240': 'GR', '241': 'GR', '247': 'IT', '271': 'TR', '304': 'AG', '305': 'AG', '308': 'BS', '309': 'BS', '311': 'BS',
  '351': 'PA', '352': 'PA', '353': 'PA', '354': 'PA', '355': 'PA', '356': 'PA', '357': 'PA', '370': 'PA', '371': 'PA', '372': 'PA', '373': 'PA', '374': 'PA', '538': 'MH', '636': 'LR',
  '637': 'LR', '563': 'SG', '564': 'SG', '565': 'SG', '566': 'SG', '477': 'HK', '412': 'CN', '413': 'CN', '414': 'CN', '431': 'JP', '432': 'JP', '440': 'KR', '441': 'KR', '419': 'IN',
  '338': 'US', '366': 'US', '367': 'US', '368': 'US', '369': 'US', '316': 'CA', '503': 'AU', '512': 'NZ', '233 ': 'GB',
};
export const landFraMmsi = (mmsi: string) => MID[mmsi.slice(0, 3)] ?? null;
/** ISO-landskode → flaggemoji og navn på norsk. */
export function flagg(kode: string | null | undefined) {
  if (!kode || !/^[A-Za-z]{2}$/.test(kode)) return null;
  const k = kode.toUpperCase();
  const emoji = String.fromCodePoint(...[...k].map((c) => 127397 + c.charCodeAt(0)));
  let navn = k;
  try { navn = new Intl.DisplayNames(['nb'], { type: 'region' }).of(k) ?? k; } catch { /* eldre nettleser */ }
  return { emoji, navn };
}
