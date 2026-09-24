import { textOn } from './api';

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
