// Sjøvei-avstand til terminalen. Feltet er forhåndsberegnet (scripts/sjovei): Dijkstra fra terminalen over
// sjøceller (Natural Earth-land, ~1 km oppløsning), så avstanden følger kysten – ikke luftlinja.
export const TERMINAL = { navn: 'Flatholmen havn 81B, Ålesund', lat: 62.47917879, lon: 6.19291566 };

export type Sjofelt = { lat1: number; lon0: number; dlat: number; dlon: number; H: number; W: number; d: Uint16Array };

let felt: Promise<Sjofelt> | null = null;

export function lastSjovei(): Promise<Sjofelt> {
  felt ??= (async () => {
    const r = await fetch('/sjovei.bin.gz');
    if (!r.ok) throw new Error('Fant ikke sjøvei-data');
    let buf = await r.arrayBuffer();
    if (new Uint8Array(buf, 0, 2).join() === '31,139') {
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    const dv = new DataView(buf);
    return {
      lat1: dv.getFloat32(4, true), lon0: dv.getFloat32(8, true), dlat: dv.getFloat32(12, true), dlon: dv.getFloat32(16, true),
      H: dv.getUint16(20, true), W: dv.getUint16(22, true), d: new Uint16Array(buf, 32),
    };
  })().catch((e) => { felt = null; throw e; });
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

/** Sjøvei fra en posisjon til terminalen, inkl. rute. `null` hvis posisjonen er utenfor kartutsnittet. */
export function sjovei(f: Sjofelt, lat: number, lon: number): Sjovei | null {
  const { lat1, lon0, dlat, dlon, H, W, d } = f;
  const cellLat = (i: number) => lat1 - (i + 0.5) * dlat;
  const cellLon = (j: number) => lon0 + (j + 0.5) * dlon;
  const i0 = Math.floor((lat1 - lat) / dlat), j0 = Math.floor((lon - lon0) / dlon);
  if (i0 < 0 || j0 < 0 || i0 >= H || j0 >= W) return null;
  const sjo = (i: number, j: number) => i >= 0 && j >= 0 && i < H && j < W && d[i * W + j] > 0;

  // Båter ved kai ligger på «land» i rutenettet – bruk nærmeste sjøcelle
  let i = i0, j = j0, ekstra = 0;
  if (!sjo(i, j)) {
    let best = Infinity;
    for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) {
      if (!sjo(i0 + a, j0 + b)) continue;
      const m = luftlinjeNm(lat, lon, cellLat(i0 + a), cellLon(j0 + b));
      if (m < best) { best = m; i = i0 + a; j = j0 + b; }
    }
    if (!isFinite(best)) return null;
    ekstra = best;
  }
  const nm = (d[i * W + j] - 1) / 10 + ekstra;

  // Følg fallet i avstandsfeltet ned til terminalen
  const punkter: [number, number][] = [[lat, lon]];
  for (let n = 0; n < 8000; n++) {
    let bi = -1, bj = -1, bd = d[i * W + j];
    for (const [di, dj] of RETN) {
      const ni = i + di, nj = j + dj;
      if (!sjo(ni, nj) || d[ni * W + nj] >= bd) continue;
      if (!mellom(di, dj).every(([a, b]) => sjo(i + a, j + b))) continue;
      bd = d[ni * W + nj]; bi = ni; bj = nj;
    }
    if (bi < 0) break;
    i = bi; j = bj;
    punkter.push([cellLat(i), cellLon(j)]);
  }
  punkter.push([TERMINAL.lat, TERMINAL.lon]);
  return { nm, luftlinje: luftlinjeNm(lat, lon, TERMINAL.lat, TERMINAL.lon), sti: forenkle(punkter, 0.004) };
}

/** Douglas–Peucker (toleranse i grader). */
function forenkle(p: [number, number][], tol: number): [number, number][] {
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
  if (maks <= tol) return [p[0], p[p.length - 1]];
  return [...forenkle(p.slice(0, idx + 1), tol).slice(0, -1), ...forenkle(p.slice(idx), tol)];
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
