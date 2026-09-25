// Simulerer hvordan CSS-rutenettet med `grid-auto-flow: dense` plasserer widgets (første ledige sted, rad for rad),
// teller tomme ruter, og kan stokke om (og justere størrelser) så det ikke blir hull.

export type Boks = { w: number; h: number };
const KOL = 12;

/** Antall tomme ruter innenfor det området widgets dekker. */
export function hull(items: Boks[], kol = KOL): number {
  const belagt: boolean[][] = [];
  let maksRad = 0;
  const ledig = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (belagt[y]?.[x]) return false;
    return true;
  };
  for (const { w: bredde, h } of items) {
    const w = Math.min(bredde, kol);
    let ok = false;
    for (let r = 0; !ok; r++) {
      for (let c = 0; c + w <= kol; c++) {
        if (!ledig(r, c, w, h)) continue;
        for (let y = r; y < r + h; y++) { belagt[y] ??= []; for (let x = c; x < c + w; x++) belagt[y][x] = true; }
        maksRad = Math.max(maksRad, r + h);
        ok = true;
        break;
      }
    }
  }
  let tomme = 0;
  for (let y = 0; y < maksRad; y++) for (let x = 0; x < kol; x++) if (!belagt[y]?.[x]) tomme++;
  return tomme;
}

function stokk<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/**
 * Finn rekkefølgen med færrest hull (og lavest total høyde). `mulige[i]` er de tillatte størrelsene for element i;
 * `valgt[i]` er indeksen som gjelder nå. Returnerer ny rekkefølge og valgte størrelser.
 */
export function rydd(mulige: Boks[][], valgt: number[], forsok = 1500): { rekkefolge: number[]; valgt: number[] } {
  const n = mulige.length;
  const vurder = (rek: number[], v: number[]) => {
    const boks = rek.map((k) => mulige[k][v[k]]);
    return hull(boks) * 1000 + boks.reduce((s, b) => s + b.h * b.w, 0) / 100; // hull først, deretter kompakthet
  };
  const beste = (v: number[], start: number[]) => {
    let rek = start, verdi = vurder(rek, v);
    for (let t = 0; t < forsok && verdi >= 1; t++) {
      const kandidat = t % 2 ? stokk(start) : swap(rek);
      const x = vurder(kandidat, v);
      if (x < verdi) { rek = kandidat; verdi = x; }
    }
    return { rek, verdi };
  };
  const swap = (rek: number[]) => {
    const b = [...rek];
    const i = Math.floor(Math.random() * n), j = Math.floor(Math.random() * n);
    [b[i], b[j]] = [b[j], b[i]];
    return b;
  };
  const start = Array.from({ length: n }, (_, i) => i);
  let v = [...valgt];
  let best = beste(v, start);
  // Fortsatt hull? Prøv å justere én widget til en annen standardstørrelse om gangen.
  for (let runde = 0; runde < 3 && best.verdi >= 1; runde++) {
    let forbedret = false;
    for (let k = 0; k < n && best.verdi >= 1; k++) {
      for (let s = 0; s < mulige[k].length; s++) {
        if (s === v[k]) continue;
        const v2 = [...v]; v2[k] = s;
        const r = beste(v2, best.rek);
        if (r.verdi < best.verdi - 0.001) { best = r; v = v2; forbedret = true; }
      }
    }
    if (!forbedret) break;
  }
  return { rekkefolge: best.rek, valgt: v };
}
