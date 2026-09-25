// Trinn 2 av 2: Dijkstra fra terminalen over sjøcellene → sjøvei-avstand (nautiske mil × 10) til hver celle.
// Bruk: node beregn.mjs maske.bin ../../web/public/sjovei.bin.gz
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const TERMINAL = { lat: 62.47917879, lon: 6.19291566 }; // Flatholmen havn 81B, Ålesund (Geonorge adresse-API)
const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const LAT1 = dv.getFloat32(0, true), LON0 = dv.getFloat32(4, true), DLAT = dv.getFloat32(8, true), DLON = dv.getFloat32(12, true);
const H = dv.getUint16(16, true), W = dv.getUint16(18, true);
const land = new Uint8Array(buf.buffer, buf.byteOffset + 20, H * W);

const rad = Math.PI / 180;
const stegNm = (i, di, dj) => {
  const lat = LAT1 - (i + 0.5) * DLAT;
  return Math.hypot(di * DLAT * 60, dj * DLON * 60 * Math.cos((lat - di * DLAT / 2) * rad));
};
const sjo = (i, j) => i >= 0 && j >= 0 && i < H && j < W && land[i * W + j] === 0;

// 16 retninger; kryss-sjekk cellene linja går gjennom så vi ikke skjærer over land
const RETN = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
const mellom = (di, dj) => {
  if (Math.abs(di) === 2) return [[di / 2, 0], [di / 2, dj]];
  if (Math.abs(dj) === 2) return [[0, dj / 2], [di, dj / 2]];
  if (di && dj) return [[di, 0], [0, dj]];
  return [];
};

// Startcelle: nærmeste sjøcelle til terminalen
let si = Math.round((LAT1 - TERMINAL.lat) / DLAT - 0.5), sj = Math.round((TERMINAL.lon - LON0) / DLON - 0.5);
if (!sjo(si, sj)) {
  let beste = null;
  for (let r = 1; r < 30 && !beste; r++)
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++)
      if (sjo(si + a, sj + b) && (!beste || Math.hypot(a, b) < beste.d)) beste = { i: si + a, j: sj + b, d: Math.hypot(a, b) };
  if (!beste) throw new Error('Fant ingen sjø nær terminalen');
  console.log(`Terminalcellen er land – bruker sjø ${beste.d.toFixed(1)} celler unna`);
  si = beste.i; sj = beste.j;
}

const N = H * W;
const dist = new Float32Array(N).fill(Infinity);
// binær min-heap
const heapK = new Float32Array(N * 3), heapV = new Int32Array(N * 3);
let hs = 0;
const push = (k, v) => { let x = hs++; while (x > 0) { const p = (x - 1) >> 1; if (heapK[p] <= k) break; heapK[x] = heapK[p]; heapV[x] = heapV[p]; x = p; } heapK[x] = k; heapV[x] = v; };
const pop = () => {
  const k0 = heapK[0], v0 = heapV[0]; hs--;
  if (hs > 0) {
    const k = heapK[hs], v = heapV[hs]; let x = 0;
    for (;;) { let c = 2 * x + 1; if (c >= hs) break; if (c + 1 < hs && heapK[c + 1] < heapK[c]) c++; if (heapK[c] >= k) break; heapK[x] = heapK[c]; heapV[x] = heapV[c]; x = c; }
    heapK[x] = k; heapV[x] = v;
  }
  return [k0, v0];
};

dist[si * W + sj] = 0; push(0, si * W + sj);
while (hs) {
  const [d, u] = pop();
  if (d > dist[u]) continue;
  const i = (u / W) | 0, j = u - i * W;
  for (const [di, dj] of RETN) {
    const ni = i + di, nj = j + dj;
    if (!sjo(ni, nj)) continue;
    if (!mellom(di, dj).every(([a, b]) => sjo(i + a, j + b))) continue;
    const nd = d + stegNm(i, di, dj);
    const v = ni * W + nj;
    if (nd < dist[v]) { dist[v] = nd; push(nd, v); }
  }
}

const ut = new Uint16Array(N);
let nadd = 0;
for (let n = 0; n < N; n++) { const x = dist[n]; if (Number.isFinite(x)) { ut[n] = Math.min(64000, Math.round(x * 10) + 1); nadd++; } } // 0 = land/utilgjengelig
const hode = Buffer.alloc(32);
hode.write('SJV1', 0, 'ascii');
hode.writeFloatLE(LAT1, 4); hode.writeFloatLE(LON0, 8); hode.writeFloatLE(DLAT, 12); hode.writeFloatLE(DLON, 16);
hode.writeUInt16LE(H, 20); hode.writeUInt16LE(W, 22); hode.writeFloatLE(TERMINAL.lat, 24); hode.writeFloatLE(TERMINAL.lon, 28);
writeFileSync(process.argv[3], gzipSync(Buffer.concat([hode, Buffer.from(ut.buffer)]), { level: 9 })); // gzip – klienten pakker ut med DecompressionStream
console.log(`${nadd} sjøceller nådd av ${N}. Skrev ${process.argv[3]}`);

// Kontrollpunkter (nautiske mil)
const sjekk = { Bergen: [60.39, 5.0], Kristiansund: [63.1, 7.6], Trondheimsfjorden: [63.7, 9.0], Haugesund: [59.4, 4.9], Bodø: [67.3, 14.2], Tromsø: [69.7, 18.8], 'Skagerrak (Kristiansand)': [58.0, 7.9] };
for (const [navn, [lat, lon]] of Object.entries(sjekk)) {
  const i = Math.round((LAT1 - lat) / DLAT - 0.5), j = Math.round((lon - LON0) / DLON - 0.5);
  console.log(navn.padEnd(26), ut[i * W + j] ? ((ut[i * W + j] - 1) / 10).toFixed(0) + ' nm' : 'land/utilgjengelig');
}
