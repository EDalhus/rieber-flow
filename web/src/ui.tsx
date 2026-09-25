import { useEffect, useState, type ReactNode } from 'react';
import { api, textOn, type Linje } from './api';

export function SaltBadge({ salttype, farge }: { salttype: string; farge: string }) {
  return (
    <span className="badge" style={{ background: farge, color: textOn(farge) }}>
      {salttype}
    </span>
  );
}

export function Progress({ value, max, farge = 'var(--accent)' }: { value: number; max: number; farge?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="progress">
      <div style={{ width: `${pct}%`, background: farge }} />
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill s-${status.replace(/\s/g, '').toLowerCase()}`}>{status}</span>;
}

const EMB: Record<Linje['emballasje'], { ikon: string; ledd: string }> = {
  Bulk: { ikon: '🚜', ledd: 'Bulk' },
  Bigbag: { ikon: '📦', ledd: 'Bigbag' },
  Pall: { ikon: '🟫', ledd: 'Pall' },
};
const nb = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Antall + emballasje, f.eks. «2 × Bigbag», «3 × Pall», «32 t Bulk». */
export const linjeAntall = (l: Linje) => (l.emballasje === 'Bulk' ? `${nb(l.antall)} t Bulk` : `${nb(l.antall)} × ${EMB[l.emballasje].ledd}`);
/** Produkt + enhet, f.eks. «Fint raffinert salt 40 × 25 kg». */
export const linjeProdukt = (l: Linje) => (l.emballasje === 'Bulk' ? l.produkt : `${l.produkt} ${l.enhet}${l.pallertype ? ` · ${l.pallertype}` : ''}`);
export const trengerKlargjoring = (linjer?: Linje[]) => !!linjer?.some((l) => l.emballasje !== 'Bulk');

/** Innholdet i en salgsordre: hva som ligger i den og hva som må klargjøres/plukkes. */
export function Linjer({ linjer, kompakt }: { linjer?: Linje[]; kompakt?: boolean }) {
  if (!linjer?.length) return null;
  return (
    <ul className={`linjer ${kompakt ? 'kompakt' : ''}`}>
      {linjer.map((l) => (
        <li key={l.id} className={l.emballasje === 'Bulk' ? '' : 'pluk'}>
          <span className="l-dot" style={{ background: l.fargekode }} />
          <span className="l-ant">{EMB[l.emballasje].ikon} {linjeAntall(l)}</span>
          <span className="l-prod">{linjeProdukt(l)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Enkel modal: lukkes med Esc eller klikk utenfor. */
export function Modal({ tittel, onLukk, children, bred }: { tittel: string; onLukk: () => void; children: ReactNode; bred?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onLukk();
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [onLukk]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onLukk()}>
      <div className={`modal ${bred ? 'bred' : ''}`} role="dialog" aria-label={tittel}>
        <div className="modal-head"><h2>{tittel}</h2><button className="icon" onClick={onLukk} aria-label="Lukk">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Krymper et bilde i nettleseren (maks 1600 px, JPEG) så det passer i databasen. */
export async function krympBilde(fil: File): Promise<File> {
  const bmp = await createImageBitmap(fil);
  for (const [maks, kvalitet] of [[1600, 0.8], [1280, 0.65], [1000, 0.55]] as const) {
    const skala = Math.min(1, maks / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * skala);
    c.height = Math.round(bmp.height * skala);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', kvalitet));
    if (blob && blob.size <= 1_100_000) return new File([blob], fil.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  throw new Error(`${fil.name} er for stort selv etter komprimering`);
}

export type AisTreff = { mmsi: string; imo: string | null; navn: string };

/** Søk opp et fartøy i AIS (navn, IMO eller MMSI) og velg det. */
export function AisVelger({ onVelg, autoFokus }: { onVelg: (t: AisTreff) => void; autoFokus?: boolean }) {
  const [q, setQ] = useState('');
  const [treff, setTreff] = useState<AisTreff[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setTreff([]); setInfo(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api<{ kilde: string; treff: AisTreff[] }>(`/ais/sok?q=${encodeURIComponent(q)}`);
        setTreff(r.treff);
        setInfo(r.kilde === 'ingen' ? 'AIS er ikke koblet til (mangler Barentswatch-nøkler).' : r.treff.length === 0 ? 'Ingen treff' : null);
      } catch (e) { setInfo((e as Error).message); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="ais-velger">
      <input value={q} autoFocus={autoFokus} onChange={(e) => setQ(e.target.value)} placeholder="Søk AIS: skipsnavn, IMO eller MMSI" />
      {info && <div className="muted ais-info">{info}</div>}
      <ul className="list">
        {treff.map((t) => (
          <li key={t.mmsi}>
            <button type="button" className="ais-treff" onClick={() => onVelg(t)}>
              <b>{t.navn}</b><small>{t.imo ? `IMO ${t.imo} · ` : ''}MMSI {t.mmsi}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
