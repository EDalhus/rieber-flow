// Trinn 3 av 3: Dijkstra fra terminalen → sjøvei-avstand (nautiske mil × 10) til hver sjøcelle.
//   1) Detaljvindu B (50 m) fra terminalen.
//   2) Hele kysten A (500 m), «seedet» med de nøyaktige avstandene fra B inne i vinduet – så A-verdiene
//      utenfor vinduet inkluderer den detaljerte sluttetappen.
// Bruk: node beregn.mjs maske-a.bin maske-b.bin ../../web/public/sjovei-a.bin.gz ../../web/public/sjovei-b.bin.gz
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const TERMINAL = { lat: 62.47917879, lon: 6.19291566 }; // Flatholmen havn 81B, Ålesund (Geonorge adresse-API)
const rad = Math.PI / 180;

function les(fil) {
  const buf = readFileSync(fil), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const g = { lat1: dv.getFloat32(0, true), lon0: dv.getFloat32(4, true), dlat: dv.getFloat32(8, true), dlon: dv.getFloat32(12, true), H: dv.getUint16(16, true), W: dv.getUint16(18, true) };
  g.land = new Uint8Array(buf.buffer, buf.byteOffset + 20, g.H * g.W);
  g.lat = (i) => g.lat1 - (i + 0.5) * g.dlat;
  g.lon = (j) => g.lon0 + (j + 0.5) * g.dlon;
  g.celle = (lat, lon) => [Math.floor((g.lat1 - lat) / g.dlat), Math.floor((lon - g.lon0) / g.dlon)];
  return g;
}

const RETN = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
// celler linja går gjennom – alle må være sjø (hindrer at ruta skjærer over land)
const mellom = (di, dj) => {
  if (Math.abs(di) === 2) return [[di / 2, 0], [di / 2, dj]];
  if (Math.abs(dj) === 2) return [[0, dj / 2], [di, dj / 2]];
  if (di && dj) return [[di, 0], [0, dj]];
  return [];
};
const MELLOM = RETN.map(([di, dj]) => mellom(di, dj));

function dijkstra(g, kilder) {
  const { H, W, land } = g, N = H * W;
  // stegslengde (nm) pr. rad og retning
  const steg = new Float32Array(H * 16);
  for (let i = 0; i < H; i++) RETN.forEach(([di, dj], k) => {
    const lat = g.lat(i) - (di * g.dlat) / 2;
    steg[i * 16 + k] = Math.hypot(di * g.dlat * 60, dj * g.dlon * 60 * Math.cos(lat * rad));
  });
  const dist = new Float32Array(N).fill(Infinity);
  let cap = 1 << 22, hk = new Float32Array(cap), hv = new Int32Array(cap), hs = 0;
  const push = (k, v) => {
    if (hs === cap) { cap *= 2; const nk = new Float32Array(cap), nv = new Int32Array(cap); nk.set(hk); nv.set(hv); hk = nk; hv = nv; }
    let x = hs++;
    while (x > 0) { const p = (x - 1) >> 1; if (hk[p] <= k) break; hk[x] = hk[p]; hv[x] = hv[p]; x = p; }
    hk[x] = k; hv[x] = v;
  };
  const pop = () => {
    const k0 = hk[0], v0 = hv[0]; hs--;
    if (hs > 0) {
      const k = hk[hs], v = hv[hs]; let x = 0;
      for (;;) { let c = 2 * x + 1; if (c >= hs) break; if (c + 1 < hs && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[x] = hk[c]; hv[x] = hv[c]; x = c; }
      hk[x] = k; hv[x] = v;
    }
    return [k0, v0];
  };
  for (const [idx, c] of kilder) if (c < dist[idx]) { dist[idx] = c; push(c, idx); }
  while (hs) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    const i = (u / W) | 0, j = u - i * W;
    for (let k = 0; k < 16; k++) {
      const ni = i + RETN[k][0], nj = j + RETN[k][1];
      if (ni < 0 || nj < 0 || ni >= H || nj >= W || land[ni * W + nj]) continue;
      let ok = true;
      for (const [a, b] of MELLOM[k]) if (land[(i + a) * W + j + b]) { ok = false; break; }
      if (!ok) continue;
      const nd = d + steg[i * 16 + k], v = ni * W + nj;
      if (nd < dist[v]) { dist[v] = nd; push(nd, v); }
    }
  }
  return dist;
}

function nermesteSjo(g, lat, lon, maks) {
  const [i0, j0] = g.celle(lat, lon);
  let beste = null;
  for (let r = 0; r <= maks && !beste; r++)
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const i = i0 + a, j = j0 + b;
      if (i < 0 || j < 0 || i >= g.H || j >= g.W || g.land[i * g.W + j]) continue;
      const d = Math.hypot(a, b);
      if (!beste || d < beste.d) beste = { i, j, d };
    }
  return beste;
}

function skriv(fil, g, dist, enhet) {  // enhet = lagringsenheter pr. nautisk mil (10 for A, 100 for B – 50 m-celler trenger finere trinn)
  const ut = new Uint16Array(g.H * g.W);
  let nadd = 0;
  for (let n = 0; n < ut.length; n++) if (Number.isFinite(dist[n])) { ut[n] = Math.min(65000, Math.round(dist[n] * enhet) + 1); nadd++; } // 0 = land/utilgjengelig
  const hode = Buffer.alloc(32);
  hode.write('SJV1', 0, 'ascii');
  hode.writeFloatLE(g.lat1, 4); hode.writeFloatLE(g.lon0, 8); hode.writeFloatLE(g.dlat, 12); hode.writeFloatLE(g.dlon, 16);
  hode.writeUInt16LE(g.H, 20); hode.writeUInt16LE(g.W, 22); hode.writeUInt16LE(enhet, 24);
  const buf = gzipSync(Buffer.concat([hode, Buffer.from(ut.buffer)]), { level: 9 });
  writeFileSync(fil, buf);
  console.log(`${fil}: ${nadd} sjøceller nådd, ${(buf.length / 1e6).toFixed(2)} MB`);
  return ut;
}

const [, , maskeA, maskeB, utA, utB] = process.argv;
const B = les(maskeB), A = les(maskeA);

// 1) Detaljvindu
const start = nermesteSjo(B, TERMINAL.lat, TERMINAL.lon, 60);
if (!start) throw new Error('Fant ingen sjø nær terminalen i detaljvinduet');
console.log(`Terminal → sjøcelle ${(start.d * B.dlat * 60).toFixed(2)} nm unna (B)`);
console.time('B'); const dB = dijkstra(B, [[start.i * B.W + start.j, 0]]); console.timeEnd('B');

// 2) Hele kysten, seedet fra B
const seeds = [];
for (let i = 0; i < A.H; i++) for (let j = 0; j < A.W; j++) {
  if (A.land[i * A.W + j]) continue;
  const lat = A.lat(i), lon = A.lon(j);
  if (lat > B.lat1 || lat < B.lat1 - B.H * B.dlat || lon < B.lon0 || lon > B.lon0 + B.W * B.dlon) continue;
  // minste B-avstand innenfor A-cellens fotavtrykk
  const [bi0, bj0] = B.celle(lat + A.dlat / 2, lon - A.dlon / 2), [bi1, bj1] = B.celle(lat - A.dlat / 2, lon + A.dlon / 2);
  let m = Infinity;
  for (let bi = Math.max(0, bi0); bi <= Math.min(B.H - 1, bi1); bi++) for (let bj = Math.max(0, bj0); bj <= Math.min(B.W - 1, bj1); bj++) { const d = dB[bi * B.W + bj]; if (d < m) m = d; }
  if (Number.isFinite(m)) seeds.push([i * A.W + j, m]);
}
console.log(`${seeds.length} A-celler seedet fra B`);
console.time('A'); const dA = dijkstra(A, seeds); console.timeEnd('A');

const uB = skriv(utB, B, dB, 100), uA = skriv(utA, A, dA, 10);

// Kontrollpunkter (nautiske mil)
const at = (g, u, e, lat, lon) => { const [i, j] = g.celle(lat, lon); const v = i >= 0 && j >= 0 && i < g.H && j < g.W ? u[i * g.W + j] : 0; return v ? `${((v - 1) / e).toFixed(1)} nm` : 'land'; };
const sjekk = { 'Godøya vest (Gullhav)': [62.46, 6.03], Kristiansund: [63.2, 7.4], 'Molde fjord': [62.72, 7.1], Bergen: [60.39, 4.9], Trondheim: [63.7, 9.0], Bodø: [67.3, 13.6], Tromsø: [70.1, 18.5], 'Stad': [62.2, 4.9], 'Oslofjord': [59.0, 10.6] };
for (const [n, [lat, lon]] of Object.entries(sjekk)) console.log(n.padEnd(24), 'A', at(A, uA, 10, lat, lon).padEnd(10), 'B', at(B, uB, 100, lat, lon));
