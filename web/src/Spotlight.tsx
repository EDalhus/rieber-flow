import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { IconSearch } from './icons';

type Treff = { kategori: string; id: string; tittel: string; sub: string; href: string };

const SIDER: Treff[] = [
  { kategori: 'Sider', id: 'p1', tittel: 'Dashboard', sub: 'Oversikt og widgets', href: '#/' },
  { kategori: 'Sider', id: 'p2', tittel: 'Båtanløp', sub: 'Kommende og pågående anløp, lasteplaner', href: '#/anlop' },
  { kategori: 'Sider', id: 'p3', tittel: 'SO-kø', sub: 'Lastebilordrer på kortest frist', href: '#/so-ko' },
  { kategori: 'Sider', id: 'p4', tittel: 'Flåte & kart', sub: 'Din flåte på kartet', href: '#/flate' },
  { kategori: 'Sider', id: 'p5', tittel: 'Kaibok', sub: 'Logg over anløp og tilbakemeldinger', href: '#/kaibok' },
  { kategori: 'Sider', id: 'p6', tittel: 'Kalender', sub: 'Båtanløp, fravær og bemanning', href: '#/kalender' },
  { kategori: 'Sider', id: 'p7', tittel: 'Admin', sub: 'Produktkatalog: bulk, bigbags og pallevarer', href: '#/admin' },
];
const HANDLINGER: Treff[] = [
  { kategori: 'Handlinger', id: 'h1', tittel: 'Ny kaibok-føring', sub: 'Logg et anløp med bilder', href: '#/kaibok?ny=1' },
  { kategori: 'Handlinger', id: 'h2', tittel: 'Legg til fravær', sub: 'Lege, verksted, skole, ferie, ikke overtid …', href: '#/kalender?nyttFravaer=1' },
  { kategori: 'Handlinger', id: 'h4', tittel: 'Nytt produkt', sub: 'Legg til bulk-, bigbag- eller pallevare i katalogen', href: '#/admin?ny=1' },
  { kategori: 'Handlinger', id: 'h3', tittel: 'Nytt båtanløp', sub: 'Opprett anløp og bygg lasteplan', href: '#/anlop' },
];
const IKON: Record<string, string> = {
  Sider: '↗', Handlinger: '⚡', Båtanløp: '🚢', Salgsordrer: '📦', Produkter: '🏷️', Kaibok: '📖', 'Flåte & båtinfo': '🗺️', Kalender: '📅', Kolleger: '👤', 'Båter i AIS': '📡',
};
const REKKEFOLGE = ['Sider', 'Handlinger', 'Båtanløp', 'Flåte & båtinfo', 'Båter i AIS', 'Salgsordrer', 'Produkter', 'Kaibok', 'Kalender', 'Kolleger'];

const norm = (s: string) => s.toLowerCase();
const erMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const SNARVEI = erMac ? '⌘ K' : 'Ctrl K';

function Uthev({ tekst, q }: { tekst: string; q: string }) {
  if (!q) return <>{tekst}</>;
  const deler = tekst.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return <>{deler.map((d, i) => (norm(d) === norm(q) ? <mark key={i}>{d}</mark> : <Fragment key={i}>{d}</Fragment>))}</>;
}

/** Global søk – åpnes med ⌘K / Ctrl+K, som Spotlight på Mac. */
export function Spotlight({ apen, onLukk }: { apen: boolean; onLukk: () => void }) {
  const [q, setQ] = useState('');
  const [server, setServer] = useState<Treff[]>([]);
  const [laster, setLaster] = useState(false);
  const [aktiv, setAktiv] = useState(0);
  const inn = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const forsok = useRef(0);

  useEffect(() => { if (apen) { setQ(''); setServer([]); setAktiv(0); setTimeout(() => inn.current?.focus(), 10); } }, [apen]);

  // Serversøk (debounce)
  useEffect(() => {
    const t = q.trim();
    if (!apen || t.length < 2) { setServer([]); setLaster(false); return; }
    setLaster(true);
    const mitt = ++forsok.current;
    const h = setTimeout(async () => {
      try {
        const r = await api<Treff[]>(`/sok?q=${encodeURIComponent(t)}`);
        if (mitt === forsok.current) setServer(r);
      } catch { if (mitt === forsok.current) setServer([]); }
      if (mitt === forsok.current) setLaster(false);
    }, 150);
    return () => clearTimeout(h);
  }, [q, apen]);

  // Sider og handlinger filtreres lokalt; tomt felt viser hurtigvalg
  const grupper = useMemo(() => {
    const t = norm(q.trim());
    const lokale = [...SIDER, ...HANDLINGER].filter((x) => !t || norm(x.tittel).includes(t) || norm(x.sub).includes(t));
    const alle = [...lokale, ...(t.length >= 2 ? server : [])];
    return REKKEFOLGE.map((k) => ({ kategori: k, treff: alle.filter((x) => x.kategori === k) })).filter((g) => g.treff.length);
  }, [q, server]);
  const flat = useMemo(() => grupper.flatMap((g) => g.treff), [grupper]);

  useEffect(() => { setAktiv(0); }, [grupper.length, q]);
  useEffect(() => { liste.current?.querySelector('[data-aktiv="true"]')?.scrollIntoView({ block: 'nearest' }); }, [aktiv]);

  const gaa = useCallback((t: Treff) => {
    onLukk();
    // Samme adresse på nytt (f.eks. samme side) skal fortsatt laste innholdet på nytt
    if (location.hash === t.href) { location.hash = ''; setTimeout(() => (location.hash = t.href), 0); } else location.hash = t.href;
  }, [onLukk]);

  if (!apen) return null;

  const tast = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAktiv((a) => (flat.length ? (a + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === 'Enter' && flat[aktiv]) { e.preventDefault(); gaa(flat[aktiv]); }
    else if (e.key === 'Escape') { e.preventDefault(); onLukk(); }
  };

  let teller = -1;
  const t = q.trim();
  return (
    <div className="spot-bg" onMouseDown={(e) => e.target === e.currentTarget && onLukk()}>
      <div className="spot" role="dialog" aria-label="Søk" onKeyDown={tast}>
        <div className="spot-inn">
          <IconSearch />
          <input ref={inn} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk i båter (også utenfor flåten), ordre, kaibok, kalender …" spellCheck={false} autoComplete="off" />
          {laster && <span className="spot-spinner" />}
          <kbd>esc</kbd>
        </div>
        <div className="spot-liste" ref={liste}>
          {grupper.map((g) => (
            <div key={g.kategori} className="spot-gruppe">
              <div className="spot-kat">{g.kategori}</div>
              {g.treff.map((x) => {
                const nr = ++teller;
                return (
                  <button key={x.id} className={`spot-rad ${nr === aktiv ? 'aktiv' : ''}`} data-aktiv={nr === aktiv} onMouseMove={() => setAktiv(nr)} onClick={() => gaa(x)}>
                    <span className="spot-ikon">{IKON[x.kategori]}</span>
                    <span className="spot-tekst">
                      <b><Uthev tekst={x.tittel} q={t} /></b>
                      <small><Uthev tekst={x.sub} q={t} /></small>
                    </span>
                    {nr === aktiv && <kbd>↵</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="spot-tom">{laster ? 'Søker …' : `Ingen treff på «${t}»`}</div>}
        </div>
        <div className="spot-fot"><span><kbd>↑</kbd><kbd>↓</kbd> naviger</span><span><kbd>↵</kbd> åpne</span><span><kbd>esc</kbd> lukk</span></div>
      </div>
    </div>
  );
}
