import { textOn, type Linje } from './api';

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
export const linjeProdukt = (l: Linje) => (l.emballasje === 'Bulk' ? l.produkt : `${l.produkt} ${l.enhet}`);
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
