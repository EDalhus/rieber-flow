import { useRef, useState, type JSX } from 'react';
import { api, useApi, fmtTonn, textOn, type Sjafor as S } from '../api';

/** Nettleser-versjon av sjåførens Kjøre-modus (samme oppførsel som Expo-appen), for demo uten telefon. */
function HoldKnapp({ tekst, onDone }: { tekst: string; onDone: () => void }) {
  const [holder, setHolder] = useState(false);
  const t = useRef<number>(0);
  return (
    <button
      className={`hold ${holder ? 'holding' : ''}`}
      onPointerDown={() => { setHolder(true); t.current = window.setTimeout(() => { setHolder(false); onDone(); }, 700); }}
      onPointerUp={() => { setHolder(false); clearTimeout(t.current); }}
      onPointerLeave={() => { setHolder(false); clearTimeout(t.current); }}
    >
      <span className="fill" />
      <span className="lbl">{tekst}</span>
    </button>
  );
}

export function Sjafor() {
  const { data, reload } = useApi<S>('/sjafor', 2000);
  const ferdig = async (path: string) => { await api(path, 'POST'); reload(); };

  let skjerm;
  let prog: JSX.Element | null = null;
  if (!data) skjerm = <div className="drv-center">Laster…</div>;
  else if (data.modus === 'bat') {
    const { batanlop: b, aktiv, neste } = data;
    if (!aktiv) skjerm = <div className="drv-center">✅<br />BÅT FERDIG<br /><small>{b.skipsnavn}</small></div>;
    else {
      skjerm = (
        <>
          <div className="drv-top">🚢 {b.skipsnavn}</div>
          <div key={aktiv.steg_id} className="drv-card pop" style={{ background: aktiv.fargekode, color: textOn(aktiv.fargekode) }}>
            <div className="drv-steg">STEG {aktiv.rekkefolge_nummer}</div>
            <div className="drv-tonn">{Math.round(aktiv.tonn)}t</div>
            <div className="drv-salt">{aktiv.salttype.toUpperCase()}</div>
            <div className="drv-kunde">{aktiv.kunde}</div>
          </div>
          <HoldKnapp tekst="HOLD INNE: FERDIG" onDone={() => ferdig(`/lasteplan/${aktiv.steg_id}/ferdig`)} />
          {neste && <div className="drv-next" style={{ borderColor: neste.fargekode }}>NESTE: {Math.round(neste.tonn)}t {neste.salttype}</div>}
        </>
      );
    }
    prog = (
      <div className="drv-prog">
        <div className="bar"><div style={{ width: `${(b.tonn_lastet / Math.max(1, b.tonn_totalt)) * 100}%` }} /></div>
        <b>{Math.round(b.tonn_lastet)} / {Math.round(b.tonn_totalt)} tonn lastet</b>
      </div>
    );
  } else {
    skjerm = (
      <>
        <div className="drv-top">🚚 Lastebil-kø</div>
        {data.ko.length === 0 && <div className="drv-center">Ingen ordrer</div>}
        {data.ko.map((s, i) => (
          <div key={s.id} className={`drv-card ${i ? 'small' : ''}`} style={{ background: s.fargekode, color: textOn(s.fargekode) }}>
            <div className="drv-tonn">{Math.round(s.tonn)}t</div>
            <div className="drv-salt">{s.salttype.toUpperCase()}</div>
            <div className="drv-kunde">{s.kunde}</div>
            {i === 0 && <HoldKnapp tekst="HOLD: FERDIG" onDone={() => ferdig(`/salgsordrer/${s.id}/ferdig`)} />}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <h1>Sjåfør-visning</h1>
      <p className="muted">Slik ser hjullastersjåføren det i appen. Start en båt fra lasteplanen – Kjøre-modus overtar automatisk.</p>
      <div className="phone">
        <div className="drv">{skjerm}{prog}</div>
      </div>
      {data && (
        <div className="drv-stock">
          {data.varer.map((v) => <span key={v.id} className="badge" style={{ background: v.fargekode, color: textOn(v.fargekode) }}>{v.salttype}: {fmtTonn(v.tonn_bulk)}</span>)}
        </div>
      )}
    </>
  );
}
