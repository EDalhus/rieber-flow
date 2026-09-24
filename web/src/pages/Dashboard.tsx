import { useCallback, useEffect, useRef, useState } from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { api, useApi, type Bat, type Dashboard as D, type SO } from '../api';
import { IconPlus } from '../icons';
import { DashCtx, STANDARD, WIDGETS, type Plass } from '../widgets';

const ROW = 60;
const MARGIN: [number, number] = [14, 14];
const def = (id: string) => WIDGETS.find((w) => w.id === id);
const Widget = ({ id }: { id: string }) => {
  const K = def(id)!.komponent;
  return <K />;
};
const rens = (l: readonly Plass[]): Plass[] => l.filter((p) => def(p.i)).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));

export function Dashboard() {
  const { data } = useApi<D>('/dashboard');
  const { data: bater } = useApi<Bat[]>('/batanlop');
  const { data: ko } = useApi<SO[]>('/so-ko');
  const { width, containerRef, mounted } = useContainerWidth();

  const [layout, setLayout] = useState<Plass[] | null>(null);
  const [redigerer, setRedigerer] = useState(false);
  const [meny, setMeny] = useState(false);
  const [lagret, setLagret] = useState<'' | 'lagrer' | 'lagret'>('');
  const timer = useRef<number>(0);

  // Personlig oppsett fra serveren (null = standard)
  useEffect(() => {
    api<{ layout: Plass[] | null }>('/meg/dashboard')
      .then((r) => setLayout(rens(r.layout ?? STANDARD)))
      .catch(() => setLayout(STANDARD));
  }, []);

  const lagre = useCallback((l: Plass[]) => {
    setLayout(l);
    setLagret('lagrer');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await api('/meg/dashboard', 'PUT', { layout: l }).catch(() => {});
      setLagret('lagret');
    }, 500);
  }, []);

  // Containeren må alltid ligge i DOM-en, ellers måles ikke bredden riktig
  if (!data || !bater || !ko || !layout) return <div ref={containerRef}><p className="muted">Laster…</p></div>;

  const skjulte = WIDGETS.filter((w) => !layout.some((p) => p.i === w.id));
  const fjern = (id: string) => lagre(layout.filter((p) => p.i !== id));
  const leggTil = (id: string) => {
    const w = def(id)!;
    const y = layout.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    lagre([...layout, { i: id, x: 0, y, w: w.w, h: w.h }]);
    setMeny(false);
  };
  const tilbakestill = async () => {
    await api('/meg/dashboard', 'DELETE').catch(() => {});
    setLayout(STANDARD);
    setLagret('');
  };

  const smal = width < 760;
  const sortert = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const kort = (p: Plass) => (
    <div key={p.i} className={`wg ${redigerer ? 'edit' : ''}`}>
      <Widget id={p.i} />
      {redigerer && (
        <div className="wg-overlay">
          <span className="wg-title">⠿ {def(p.i)!.tittel}</span>
          <button className="wg-x" onClick={() => fjern(p.i)} title="Fjern widget">✕</button>
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef}>
     <DashCtx.Provider value={{ data, bater, ko }}>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Planlegg, prioriter og få båtene lastet uten dødtid.</p>
        </div>
        <div className="btns">
          {redigerer ? (
            <>
              <span className="muted lagre-status">{lagret === 'lagrer' ? 'Lagrer…' : lagret === 'lagret' ? 'Lagret ✓' : ''}</span>
              <div className="add-wrap">
                <button className="btn ghost" onClick={() => setMeny(!meny)}><IconPlus /> Legg til widget</button>
                {meny && (
                  <div className="add-meny">
                    {skjulte.length === 0 && <span className="muted pad">Alle widgets er på dashboardet</span>}
                    {skjulte.map((w) => <button key={w.id} onClick={() => leggTil(w.id)}>{w.tittel}</button>)}
                  </div>
                )}
              </div>
              <button className="btn ghost" onClick={tilbakestill}>Standard</button>
              <button className="btn primary" onClick={() => { setRedigerer(false); setMeny(false); }}>Ferdig</button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setRedigerer(true)}>⠿ Tilpass</button>
              <a className="btn primary" href="#/anlop"><IconPlus /> Nytt båtanløp</a>
            </>
          )}
        </div>
      </div>

      <div>
        {mounted && smal && (
          <div className="stack">
            {sortert.map((p) => <div key={p.i} className="wg" style={{ height: p.h * ROW + (p.h - 1) * MARGIN[1] }}><Widget id={p.i} /></div>)}
          </div>
        )}
        {mounted && !smal && (
          <ReactGridLayout
            width={width}
            layout={layout.map((p) => ({ ...p, minW: def(p.i)!.minW, minH: def(p.i)!.minH }))}
            gridConfig={{ cols: 12, rowHeight: ROW, margin: MARGIN, containerPadding: [0, 0] }}
            dragConfig={{ enabled: redigerer, cancel: '.wg-x' }}
            resizeConfig={{ enabled: redigerer }}
            onLayoutChange={(l) => { if (redigerer) lagre(rens(l as Plass[])); }}
            className={redigerer ? 'grid-edit' : ''}
          >
            {layout.map(kort)}
          </ReactGridLayout>
        )}
      </div>
     </DashCtx.Provider>
    </div>
  );
}
