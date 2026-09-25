import { useEffect, useState, type ReactNode } from 'react';
import { useDash } from './dashctx';
import { EKSTRA_WIDGETS } from './widgets-ekstra';
import { fmtDato, fmtTonn } from './api';
import { IconArrow } from './icons';
import { StatusPill } from './ui';

export { DashCtx } from './dashctx';

function useNow() {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t); }, []);
  return n;
}

function Kpi({ tittel, verdi, sub, href, mork }: { tittel: string; verdi: string; sub: string; href: string; mork?: boolean }) {
  return (
    <a href={href} className={`kpi ${mork ? 'dark' : ''}`}>
      <div className="row"><span>{tittel}</span><i className="circ"><IconArrow /></i></div>
      <div className="kpi-v">{verdi}</div>
      <div className="kpi-sub">{sub}</div>
    </a>
  );
}

function Gauge({ pct }: { pct: number }) {
  const r = 100, len = Math.PI * r;
  return (
    <div className="gauge">
      <svg viewBox="0 0 260 150">
        <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stopColor="#1f7a4d" /><stop offset="1" stopColor="#0d3b26" /></linearGradient></defs>
        <path d="M30 130 A100 100 0 0 1 230 130" className="gauge-track" />
        <path d="M30 130 A100 100 0 0 1 230 130" className="gauge-val" strokeDasharray={`${(len * pct) / 100} ${len}`} />
      </svg>
      <div className="gauge-txt"><b>{Math.round(pct)}%</b><span>Lastet</span></div>
    </div>
  );
}

// ---------- Widgets ----------

function KpiLager() {
  const { data } = useDash();
  return <Kpi mork tittel="Lager (bulk)" verdi={fmtTonn(data.totalt.tonn_bulk).replace(' t', '')} sub={`${data.totalt.antall_bigbags.toLocaleString('nb-NO')} bigbags på lager`} href="#/" />;
}

function KpiAnlop() {
  const { bater } = useDash();
  const aktive = bater.filter((b) => b.status !== 'Ferdig');
  const lasting = bater.find((b) => b.status === 'Lasting');
  return <Kpi tittel="Aktive båtanløp" verdi={String(aktive.length)} sub={lasting ? `${lasting.skipsnavn} lastes nå` : 'Ingen lasting pågår'} href="#/anlop" />;
}

function KpiOrdrer() {
  const { ko } = useDash();
  return <Kpi tittel="Åpne lastebilordrer" verdi={String(ko.length)} sub={ko[0] ? `Første frist ${fmtDato(ko[0].frist)}` : 'Køen er tom'} href="#/so-ko" />;
}

function KpiGjenstar() {
  const { bater } = useDash();
  const aktive = bater.filter((b) => b.status !== 'Ferdig');
  const gjenstar = aktive.reduce((s, b) => s + (b.tonn_totalt - b.tonn_lastet), 0);
  return <Kpi tittel="Gjenstår å laste" verdi={String(Math.round(gjenstar))} sub={`tonn fordelt på ${aktive.filter((b) => b.antall_steg).length} båter`} href="#/anlop" />;
}

function Produksjon() {
  const { data } = useDash();
  const dager = data.produksjonPerDag.slice(-7);
  const maks = Math.max(...dager.map((d) => d.bigbags));
  const minst = Math.min(...dager.map((d) => d.bigbags));
  return (
    <section className="panel">
      <h3>Bigbag-produksjon siste 7 dager</h3>
      <div className="pills">
        {dager.map((d) => {
          const dag = new Date(d.dato).getDay();
          const helg = dag === 0 || dag === 6;
          const topp = d.bigbags === maks;
          const h = 45 + ((d.bigbags - minst) / Math.max(1, maks - minst)) * 55;
          return (
            <div key={d.dato} className="pill-col">
              <div className="pill-bar-wrap">
                {topp && <span className="tip">{d.bigbags}</span>}
                <div className={`pill-bar ${helg ? 'hatch' : topp ? 'darkest' : 'mid'}`} style={{ height: `${h}%` }} title={`${d.dato}: ${d.bigbags} bigbags`} />
              </div>
              <span>{new Date(d.dato).toLocaleDateString('nb-NO', { weekday: 'narrow' }).toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LastesNa() {
  const { bater } = useDash();
  const lasting = bater.find((b) => b.status === 'Lasting');
  return (
    <section className="panel">
      <h3>Lastes nå</h3>
      {lasting ? (
        <>
          <div className="feature">{lasting.skipsnavn}</div>
          <p className="muted">{Math.round(lasting.tonn_lastet)} av {Math.round(lasting.tonn_totalt)} tonn · {lasting.antall_steg} steg</p>
          <a className="btn primary wide" href={`#/anlop/${lasting.id}`}>Åpne lasteplan</a>
        </>
      ) : (
        <>
          <div className="feature">Ingen båt lastes</div>
          <p className="muted">Start lasting fra et båtanløp med ferdig lasteplan.</p>
          <a className="btn primary wide" href="#/anlop">Gå til båtanløp</a>
        </>
      )}
    </section>
  );
}

function Batanlop() {
  const { bater } = useDash();
  return (
    <section className="panel">
      <h3>Båtanløp</h3>
      <ul className="list">
        {bater.map((b) => (
          <li key={b.id}>
            <a href={`#/anlop/${b.id}`}>
              <span className={`dot d-${b.status.toLowerCase()}`} />
              <span className="li-main"><b>{b.skipsnavn}</b><small>ETA {fmtDato(b.eta)}</small></span>
              <StatusPill status={b.status} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Beholdning() {
  const { data } = useDash();
  return (
    <section className="panel">
      <h3>Beholdning (on-hand)</h3>
      <ul className="list roomy">
        {data.varer.map((v) => (
          <li key={v.id}>
            <span className="salt-dot" style={{ background: v.fargekode }} />
            <span className="li-main"><b>{v.salttype}</b><small>{v.antall_bigbags.toLocaleString('nb-NO')} bigbags</small></span>
            <b className="li-r">{fmtTonn(v.tonn_bulk)}</b>
          </li>
        ))}
      </ul>
      <table className="mini">
        <thead><tr><th>Periode</th><th className="num">Bigbags</th><th className="num">Solgt (t)</th></tr></thead>
        <tbody>
          {data.perioder.map((p) => (
            <tr key={p.dager}><td>{p.dager === 1 ? 'I dag' : `${p.dager} dager`}</td><td className="num">{p.bigbags.toLocaleString('nb-NO')}</td><td className="num">{p.salgTonn.toLocaleString('nb-NO')}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Framdrift() {
  const { bater } = useDash();
  const lasting = bater.find((b) => b.status === 'Lasting');
  const pct = lasting ? (lasting.tonn_lastet / Math.max(1, lasting.tonn_totalt)) * 100 : 0;
  return (
    <section className="panel">
      <h3>Lasteframdrift</h3>
      <Gauge pct={pct} />
      <div className="legend"><span><i className="lg g" /> Lastet</span><span><i className="lg d" /> Gjenstår</span></div>
    </section>
  );
}

function NesteFrist() {
  const { ko } = useDash();
  const now = useNow();
  const neste = ko[0];
  const rest = neste ? Math.max(0, new Date(neste.frist).getTime() - now) : 0;
  const hms = [Math.floor(rest / 3600000), Math.floor(rest / 60000) % 60, Math.floor(rest / 1000) % 60].map((x) => String(x).padStart(2, '0')).join(':');
  return (
    <section className="panel dark tracker">
      <h3>Neste lastebil-frist</h3>
      {neste ? (
        <>
          <div className="clock">{hms}</div>
          <p>{neste.ordrenummer} · {neste.kunde}<br /><b>{neste.tonn} t {neste.salttype}</b></p>
        </>
      ) : <div className="clock">—</div>}
    </section>
  );
}

// ---------- Register ----------
// Nye widgets legges bare til her: de dukker automatisk opp i «Legg til widget».

export type WidgetDef = { id: string; tittel: string; beskrivelse?: string; w: number; h: number; minW: number; minH: number; komponent: () => ReactNode };

export const WIDGETS: WidgetDef[] = [
  { id: 'kpi-lager', tittel: 'Lager (bulk)', w: 3, h: 3, minW: 2, minH: 3, komponent: KpiLager },
  { id: 'kpi-anlop', tittel: 'Aktive båtanløp', w: 3, h: 3, minW: 2, minH: 3, komponent: KpiAnlop },
  { id: 'kpi-ordrer', tittel: 'Åpne lastebilordrer', w: 3, h: 3, minW: 2, minH: 3, komponent: KpiOrdrer },
  { id: 'kpi-gjenstar', tittel: 'Gjenstår å laste', w: 3, h: 3, minW: 2, minH: 3, komponent: KpiGjenstar },
  { id: 'produksjon', tittel: 'Bigbag-produksjon', w: 6, h: 6, minW: 4, minH: 4, komponent: Produksjon },
  { id: 'lastes-na', tittel: 'Lastes nå', w: 3, h: 6, minW: 3, minH: 4, komponent: LastesNa },
  { id: 'batanlop', tittel: 'Båtanløp', w: 3, h: 6, minW: 3, minH: 4, komponent: Batanlop },
  { id: 'beholdning', tittel: 'Beholdning (on-hand)', w: 5, h: 8, minW: 3, minH: 5, komponent: Beholdning },
  { id: 'framdrift', tittel: 'Lasteframdrift', w: 4, h: 8, minW: 3, minH: 5, komponent: Framdrift },
  { id: 'neste-frist', tittel: 'Neste lastebil-frist', w: 3, h: 8, minW: 3, minH: 4, komponent: NesteFrist },
  ...EKSTRA_WIDGETS,
];

export type Plass = { i: string; x: number; y: number; w: number; h: number };

/** Standardoppsettet (samme som før): KPI-rad, tre paneler, tre paneler. */
export const STANDARD: Plass[] = [
  ...['kpi-lager', 'kpi-anlop', 'kpi-ordrer', 'kpi-gjenstar'].map((i, n) => ({ i, x: n * 3, y: 0, w: 3, h: 3 })),
  { i: 'produksjon', x: 0, y: 3, w: 6, h: 6 },
  { i: 'lastes-na', x: 6, y: 3, w: 3, h: 6 },
  { i: 'batanlop', x: 9, y: 3, w: 3, h: 6 },
  { i: 'beholdning', x: 0, y: 9, w: 5, h: 8 },
  { i: 'framdrift', x: 5, y: 9, w: 4, h: 8 },
  { i: 'neste-frist', x: 9, y: 9, w: 3, h: 8 },
];
