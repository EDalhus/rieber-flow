import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, useApi, type Bat, type Dashboard as D, type SO } from '../api';
import { IconPlus } from '../icons';
import { DashCtx } from '../dashctx';
import { STANDARD, WIDGETS, def, fraServer, tilServer, type Mål, type Plass, type Str } from '../widgets';
import { hull, rydd } from '../pakking';

const boksAv = (p: Plass) => { const [w, h] = def(p.i)!.storrelser[p.s]!; return { w, h }; };
/** Ordner widgets (og justerer om nødvendig størrelsene) slik at rutenettet fylles uten hull. */
function ryddOpp(l: Plass[]): Plass[] {
  const nokler = l.map((p) => Object.keys(def(p.i)!.storrelser) as Str[]);
  const mulige = l.map((p, n) => nokler[n].map((s) => boksAv({ i: p.i, s })));
  const valgt = l.map((p, n) => nokler[n].indexOf(p.s));
  const r = rydd(mulige, valgt);
  return r.rekkefolge.map((k) => ({ i: l[k].i, s: nokler[k][r.valgt[k]] }));
}

const RAD = 60;
const GAP = 14;

/** Ett widget-kort i rutenettet. I redigeringsmodus kan det dras, fjernes og få ny størrelse (S/M/L). */
function Kort({ p, kolonner, redigerer, onFjern, onStr }: { p: Plass; kolonner: number; redigerer: boolean; onFjern: () => void; onStr: (s: Str) => void }) {
  const d = def(p.i)!;
  const [w, h] = d.storrelser[p.s]!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.i, disabled: !redigerer });
  const K = d.komponent;
  return (
    <div
      ref={setNodeRef}
      className={`wg ${redigerer ? 'edit' : ''} ${isDragging ? 'drar' : ''}`}
      style={{ gridColumn: `span ${Math.min(w, kolonner)}`, gridRow: `span ${h}`, transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 30 : undefined }}
      {...(redigerer ? { ...attributes, ...listeners } : {})}
    >
      <K s={p.s} />
      {redigerer && (
        <div className="wg-overlay">
          <span className="wg-title">⠿ {d.tittel}</span>
          <button className="wg-x" onPointerDown={(e) => e.stopPropagation()} onClick={onFjern} title="Fjern widget">✕</button>
          {Object.keys(d.storrelser).length > 1 && (
            <div className="wg-str" onPointerDown={(e) => e.stopPropagation()}>
              {(Object.entries(d.storrelser) as [Str, Mål][]).map(([s, m]) => (
                <button key={s} className={s === p.s ? 'valgt' : ''} onClick={() => onStr(s)} title={`${m[0]} × ${m[1]}`}>{s}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { data } = useApi<D>('/dashboard');
  const { data: bater } = useApi<Bat[]>('/batanlop');
  const { data: ko } = useApi<SO[]>('/so-ko');
  const boks = useRef<HTMLDivElement>(null);
  const [bredde, setBredde] = useState(0);

  const [layout, setLayout] = useState<Plass[] | null>(null);
  const [redigerer, setRedigerer] = useState(false);
  const [meny, setMeny] = useState(false);
  const [lagret, setLagret] = useState<'' | 'lagrer' | 'lagret'>('');
  const timer = useRef<number>(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Personlig oppsett fra serveren (null = standard)
  useEffect(() => {
    api<{ layout: { i: string; x: number; y: number; w: number; h: number }[] | null }>('/meg/dashboard')
      .then((r) => setLayout(r.layout ? fraServer(r.layout) : STANDARD))
      .catch(() => setLayout(STANDARD));
  }, []);

  // Antall kolonner følger bredden: 12 (bredt) / 6 (medium) / 3 (smalt)
  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBredde(el.clientWidth));
    ro.observe(el);
    setBredde(el.clientWidth);
    return () => ro.disconnect();
  });

  const lagre = useCallback((l: Plass[]) => {
    setLayout(l);
    setLagret('lagrer');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await api('/meg/dashboard', 'PUT', { layout: tilServer(l) }).catch(() => {});
      setLagret('lagret');
    }, 500);
  }, []);

  if (!data || !bater || !ko || !layout) return <div ref={boks}><p className="muted">Laster…</p></div>;

  const kolonner = bredde >= 1000 ? 12 : bredde >= 640 ? 6 : 3;
  const skjulte = WIDGETS.filter((w) => !layout.some((p) => p.i === w.id));
  const fjern = (id: string) => lagre(layout.filter((p) => p.i !== id));
  const leggTil = (id: string) => { lagre(ryddOpp([...layout, { i: id, s: def(id)!.standard }])); setMeny(false); };
  const tommeRuter = hull(layout.map(boksAv));
  const byttStr = (id: string, s: Str) => lagre(layout.map((p) => (p.i === id ? { ...p, s } : p)));
  const tilbakestill = async () => {
    await api('/meg/dashboard', 'DELETE').catch(() => {});
    setLayout(STANDARD);
    setLagret('');
  };
  const slipp = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fra = layout.findIndex((p) => p.i === e.active.id), til = layout.findIndex((p) => p.i === e.over!.id);
    if (fra >= 0 && til >= 0) lagre(arrayMove(layout, fra, til));
  };

  return (
    <div ref={boks}>
      <DashCtx.Provider value={{ data, bater, ko }}>
        <div className="page-head">
          <div>
            <h1>Dashboard</h1>
            <p className="sub">Dagens drift på et blikk</p>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={slipp}>
          <SortableContext items={layout.map((p) => p.i)} strategy={rectSortingStrategy}>
            <div className="dgrid" style={{ gridTemplateColumns: `repeat(${kolonner}, minmax(0, 1fr))`, gridAutoRows: `${RAD}px`, gap: GAP }}>
              {layout.map((p) => (
                <Kort key={p.i} p={p} kolonner={kolonner} redigerer={redigerer} onFjern={() => fjern(p.i)} onStr={(s) => byttStr(p.i, s)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {redigerer ? (
          <div className="tilpass-bar">
            <span className="muted lagre-status">{lagret === 'lagrer' ? 'Lagrer…' : lagret === 'lagret' ? 'Lagret ✓' : 'Dra for å flytte · S/M/L for størrelse'}</span>
            <div className="add-wrap">
              <button className="btn ghost sm" onClick={() => setMeny(!meny)}><IconPlus /> Legg til widget</button>
              {meny && (
                <div className="add-meny opp">
                  {skjulte.length === 0 && <span className="muted pad">Alle widgets er på dashboardet</span>}
                  {skjulte.map((w) => <button key={w.id} onClick={() => leggTil(w.id)}><b>{w.tittel}</b>{w.beskrivelse && <small>{w.beskrivelse}</small>}</button>)}
                </div>
              )}
            </div>
            {tommeRuter > 0 && <button className="btn ghost sm hull" onClick={() => lagre(ryddOpp(layout))} title="Ordner og tilpasser størrelsene så alle rutene fylles">🧹 Rydd opp · {tommeRuter} tomme ruter</button>}
            <button className="btn ghost sm" onClick={tilbakestill}>Standard</button>
            <button className="btn primary sm" onClick={() => { setRedigerer(false); setMeny(false); }}>Ferdig</button>
          </div>
        ) : (
          <div className="tilpass-rad"><button className="tilpass-knapp" onClick={() => setRedigerer(true)}>⠿ Tilpass dashboard</button></div>
        )}
      </DashCtx.Provider>
    </div>
  );
}
