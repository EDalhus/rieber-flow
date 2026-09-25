import { useEffect, useState } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable,
  closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, useApi, fmtDato, fmtTonn, textOn, type Bat, type SO, type Steg } from '../api';
import { Linjer, Modal, Progress, SaltBadge, StatusPill } from '../ui';
import { IconPlus } from '../icons';

// ---------- Liste over båtanløp ----------

export function Anlop() {
  const { data, reload } = useApi<Bat[]>('/batanlop');
  const [nytt, setNytt] = useState({ skipsnavn: '', eta: '' });
  const [apen, setApen] = useState(() => !!new URLSearchParams(location.hash.split('?')[1] ?? '').get('ny'));
  return (
    <>
      <div className="page-head">
        <div><h1>Båtanløp</h1></div>
        <div className="btns"><button className="btn primary" onClick={() => setApen(true)}><IconPlus /> Nytt båtanløp</button></div>
      </div>
      <div className="grid3">
        {data?.map((b) => (
          <a key={b.id} className="card boat" href={`#/anlop/${b.id}`}>
            <div className="row"><b>{b.skipsnavn}</b><StatusPill status={b.status} /></div>
            <div className="muted">ETA {fmtDato(b.eta)}</div>
            <Progress value={b.tonn_lastet} max={b.tonn_totalt} />
            <div className="muted">
              {b.antall_steg === 0 ? 'Ingen lasteplan ennå' : `${Math.round(b.tonn_lastet)} / ${Math.round(b.tonn_totalt)} tonn · ${b.antall_steg} steg`}
            </div>
          </a>
        ))}
      </div>
      {apen && (
        <Modal tittel="Nytt båtanløp" onLukk={() => setApen(false)}>
          <form
            className="skjema"
            onSubmit={async (e) => {
              e.preventDefault();
              await api('/batanlop', 'POST', { skipsnavn: nytt.skipsnavn, eta: new Date(nytt.eta).toISOString() });
              setNytt({ skipsnavn: '', eta: '' });
              setApen(false);
              reload();
            }}
          >
            <label>Skipsnavn<input required autoFocus placeholder="F.eks. MV Nordic Star" value={nytt.skipsnavn} onChange={(e) => setNytt({ ...nytt, skipsnavn: e.target.value })} /></label>
            <label>Forventet ankomst (ETA)<input required type="datetime-local" value={nytt.eta} onChange={(e) => setNytt({ ...nytt, eta: e.target.value })} /></label>
            <div className="modal-bunn" style={{ gridColumn: '1 / -1' }}>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn ghost" onClick={() => setApen(false)}>Avbryt</button>
              <button className="btn primary">Opprett</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Lasteplan med drag-and-drop ----------

const soId = (id: number) => `so-${id}`;

function Kort({ so, farge, children, dragProps, style, locked }: any) {
  return (
    <div className={`so-card ${locked ? 'locked' : ''}`} style={{ borderLeftColor: farge, ...style }} {...dragProps}>
      <div className="grip">{locked ? '🔒' : '⠿'}</div>
      <div className="so-main">
        <div className="row"><b>{so.ordrenummer}</b><b>{fmtTonn(so.tonn)}</b></div>
        <div className="muted">{so.kunde}</div>
        <SaltBadge salttype={so.salttype} farge={farge} />
        <Linjer linjer={so.linjer} kompakt />
      </div>
      {children}
    </div>
  );
}

function LedigKort({ so, onAdd, disabled }: { so: SO; onAdd: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: soId(so.id), disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : 0, position: 'relative' }}>
      <Kort so={so} farge={so.fargekode} dragProps={{ ...attributes, ...listeners }}>
        <button className="icon" disabled={disabled} onPointerDown={(e) => e.stopPropagation()} onClick={onAdd} title="Legg til i lasteplan">＋</button>
      </Kort>
    </div>
  );
}

function StegKort({ steg, nr, onRemove }: { steg: Steg; nr: number; onRemove: () => void }) {
  const locked = steg.steg_status === 'Ferdig';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: soId(steg.so_id), disabled: locked });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }} className="steg">
      <div className="steg-nr" style={{ background: steg.fargekode, color: textOn(steg.fargekode) }}>Steg {nr}</div>
      <Kort so={steg} farge={steg.fargekode} locked={locked} dragProps={locked ? {} : { ...attributes, ...listeners }}>
        {steg.steg_status !== 'Venter' ? <StatusPill status={steg.steg_status} /> : (
          <button className="icon" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} title="Fjern fra lasteplan">✕</button>
        )}
      </Kort>
    </div>
  );
}

export function Lasteplan({ id }: { id: number }) {
  const { data, reload } = useApi<{ batanlop: Bat; steg: Steg[] }>(`/batanlop/${id}`, 4000);
  const { data: ledige, reload: reloadLedige } = useApi<SO[]>('/so-ko', 0);
  const [plan, setPlan] = useState<Steg[]>([]);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const { setNodeRef: planRef, isOver: overPlan } = useDroppable({ id: 'plan' });
  const { setNodeRef: ledigRef, isOver: overLedig } = useDroppable({ id: 'ledig' });

  // Ikke overskriv lokal rekkefølge mens vi lagrer
  useEffect(() => { if (data && !lagrer) setPlan(data.steg); }, [data, lagrer]);
  if (!data) return <p className="muted">Laster…</p>;
  const { batanlop: b } = data;
  const ferdig = b.status === 'Ferdig';
  const laast = plan.filter((s) => s.steg_status === 'Ferdig').length;

  async function lagre(neste: Steg[]) {
    setPlan(neste);
    setLagrer(true);
    try {
      await api(`/batanlop/${id}/lasteplan`, 'PUT', { so_ids: neste.map((s) => s.so_id) });
      setFeil(null);
    } catch (e) { setFeil((e as Error).message); }
    await Promise.all([reload(), reloadLedige()]);
    setLagrer(false);
  }

  const nyttSteg = (so: SO): Steg => ({
    steg_id: -so.id, batanlop_id: id, so_id: so.id, rekkefolge_nummer: 0, steg_status: 'Venter',
    ordrenummer: so.ordrenummer, kunde: so.kunde, salttype: so.salttype, tonn: so.tonn, frist: so.frist, fargekode: so.fargekode, linjer: so.linjer,
  });

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || ferdig) return;
    const aktivId = String(e.active.id);
    const overId = String(e.over.id);
    const iPlan = plan.findIndex((s) => soId(s.so_id) === aktivId);
    const overIdx = plan.findIndex((s) => soId(s.so_id) === overId);

    if (iPlan >= 0) {
      if (overId === 'ledig') {
        if (plan[iPlan].steg_status === 'Venter') lagre(plan.filter((_, i) => i !== iPlan));
      } else if (overIdx >= 0 && overIdx >= laast && overIdx !== iPlan) {
        lagre(arrayMove(plan, iPlan, overIdx));
      }
    } else if (overId === 'plan' || overIdx >= 0) {
      const so = ledige?.find((s) => soId(s.id) === aktivId);
      if (!so) return;
      const at = overIdx >= 0 ? Math.max(overIdx, laast) : plan.length;
      lagre([...plan.slice(0, at), nyttSteg(so), ...plan.slice(at)]);
    }
  }

  const tonnPlan = plan.reduce((s, x) => s + x.tonn, 0);
  return (
    <>
      <a href="#/anlop" className="back">← Båtanløp</a>
      <div className="row head">
        <div>
          <h1>{b.skipsnavn} <StatusPill status={b.status} /></h1>
          <div className="muted">ETA {fmtDato(b.eta)}</div>
        </div>
        <div className="actions">
          {lagrer && <span className="muted">Lagrer…</span>}
          {b.status !== 'Lasting' && !ferdig && (
            <button className="primary" disabled={plan.length === 0}
              onClick={async () => { try { await api(`/batanlop/${id}/start`, 'POST'); reload(); } catch (e) { setFeil((e as Error).message); } }}>
              ▶ Start lasting
            </button>
          )}
        </div>
      </div>
      {feil && <div className="error">{feil}</div>}
      {b.tonn_totalt > 0 && (
        <div className="card">
          <Progress value={b.tonn_lastet} max={b.tonn_totalt} />
          <div className="muted">{Math.round(b.tonn_lastet)} / {Math.round(b.tonn_totalt)} tonn lastet</div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="plan-grid">
          <section>
            <h2>Ledige salgsordrer</h2>
            <p className="muted">Dra til lasteplanen – på tvers av kunder og salttyper.</p>
            <div ref={ledigRef} className={`dropzone ${overLedig ? 'over' : ''}`}>
              {ledige?.map((so) => <LedigKort key={so.id} so={so} disabled={ferdig} onAdd={() => lagre([...plan, nyttSteg(so)])} />)}
              {ledige?.length === 0 && <p className="muted">Ingen ledige ordrer</p>}
            </div>
          </section>
          <section>
            <h2>Lasteplan <span className="muted">· {plan.length} steg · {fmtTonn(tonnPlan)}</span></h2>
            <p className="muted">Rekkefølgen er sekvensen sjåføren følger. Ferdige steg er låst.</p>
            <div ref={planRef} className={`dropzone plan ${overPlan ? 'over' : ''}`}>
              <SortableContext items={plan.map((s) => soId(s.so_id))} strategy={verticalListSortingStrategy}>
                {plan.map((s, i) => (
                  <StegKort key={s.so_id} steg={s} nr={i + 1} onRemove={() => lagre(plan.filter((x) => x.so_id !== s.so_id))} />
                ))}
              </SortableContext>
              {plan.length === 0 && <p className="muted empty">Slipp ordrer her for å bygge lasteplanen</p>}
            </div>
          </section>
        </div>
      </DndContext>
    </>
  );
}
