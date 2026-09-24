import { useEffect, useRef, useState } from 'react';
import { api, type Bat, type SO } from './api';
import { IconSearch } from './icons';

/** Global søk på skipsnavn, ordrenummer og kunde. */
export function Search() {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState<{ bater: Bat[]; so: SO[] } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'Escape') { setQ(''); ref.current?.blur(); }
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, []);

  const last = async () => {
    const [bater, so] = await Promise.all([api<Bat[]>('/batanlop'), api<SO[]>('/salgsordrer')]);
    setIdx({ bater, so });
  };
  const t = q.trim().toLowerCase();
  const treff = t && idx ? [
    ...idx.bater.filter((b) => b.skipsnavn.toLowerCase().includes(t)).map((b) => ({ key: `b${b.id}`, tittel: b.skipsnavn, sub: 'Båtanløp', href: `#/anlop/${b.id}` })),
    ...idx.so.filter((s) => `${s.ordrenummer} ${s.kunde}`.toLowerCase().includes(t)).slice(0, 6)
      .map((s) => ({ key: `s${s.id}`, tittel: `${s.ordrenummer} · ${s.kunde}`, sub: `${s.tonn} t ${s.salttype}`, href: s.batanlop_id ? `#/anlop/${s.batanlop_id}` : '#/so-ko' })),
  ] : [];

  return (
    <div className="search">
      <IconSearch />
      <input ref={ref} value={q} placeholder="Søk båt, ordre eller kunde" onFocus={last} onChange={(e) => setQ(e.target.value)} />
      <kbd>⌘ K</kbd>
      {t && (
        <div className="search-res">
          {treff.map((r) => (
            <a key={r.key} href={r.href} onClick={() => setQ('')}><b>{r.tittel}</b><span>{r.sub}</span></a>
          ))}
          {treff.length === 0 && <span className="muted pad">Ingen treff</span>}
        </div>
      )}
    </div>
  );
}
