import { useEffect, useState, type ReactNode } from 'react';
import { useDash } from './dashctx';
import { EKSTRA_WIDGETS } from './widgets-ekstra';
import { fmtDato, fmtTonn, fristTekst, mengdeTekst } from './api';
import { IconArrow } from './icons';
import { Progress, StatusPill } from './ui';

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

// ---------- Størrelser ----------
// Alle widgets har faste standardstørrelser på et 12-kolonners rutenett (bredde 3/6/9/12, høyde 3 eller 6 rader),
// så de alltid passer sammen. S/M/L viser mer informasjon jo større de er.

export type Str = 'S' | 'M' | 'L';
export type Mål = [w: number, h: number];
export type WidgetDef = {
  id: string; tittel: string; beskrivelse?: string;
  storrelser: Partial<Record<Str, Mål>>; standard: Str;
  komponent: (p: { s: Str }) => ReactNode;
};
export type Plass = { i: string; s: Str };

// ---------- Widgets ----------

function KpiLager() {
  const { data } = useDash();
  return <Kpi mork tittel="Lager (bulk)" verdi={fmtTonn(data.totalt.tonn_bulk).replace(' t', '')} sub={`${data.totalt.antall_bigbags.toLocaleString('nb-NO')} bigbags · ${data.totalt.antall_paller.toLocaleString('nb-NO')} paller`} href="#/" />;
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

function Produksjon({ s }: { s: Str }) {
  const { data } = useDash();
  const dager = data.utlevertPerDag.slice(s === 'L' ? -30 : -7);
  const maks = Math.max(...dager.map((d) => d.tonn));
  const total = dager.reduce((x, d) => x + d.tonn, 0);
  return (
    <section className={`panel ${s === 'S' ? 'kompakt' : ''}`}>
      <div className="row"><h3>Utlevert siste {dager.length} dager</h3><span className="muted">{fmtTonn(total)}</span></div>
      {maks === 0 ? (
        <p className="muted pr-tom">Ingen utleveringer ennå. Tall vises her når ordrer og lastesteg er markert ferdige.</p>
      ) : (
        <div className={`pills ${s === 'L' ? 'tett' : ''}`}>
          {dager.map((d, n) => {
            const dag = new Date(d.dato).getDay();
            const helg = dag === 0 || dag === 6;
            const topp = d.tonn === maks;
            const h = d.tonn === 0 ? 6 : 20 + (d.tonn / maks) * 80;
            return (
              <div key={d.dato} className="pill-col">
                <div className="pill-bar-wrap">
                  {topp && <span className="tip">{fmtTonn(d.tonn)}</span>}
                  <div className={`pill-bar ${d.tonn === 0 ? 'hatch' : helg ? 'hatch' : topp ? 'darkest' : 'mid'}`} style={{ height: `${h}%` }} title={`${d.dato}: ${fmtTonn(d.tonn)}`} />
                </div>
                <span>{s === 'L' ? (n % 3 === 0 ? new Date(d.dato).getDate() : '') : new Date(d.dato).toLocaleDateString('nb-NO', { weekday: 'narrow' }).toUpperCase()}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LastesNa({ s }: { s: Str }) {
  const { bater } = useDash();
  const lasting = bater.find((b) => b.status === 'Lasting');
  const pct = lasting ? (lasting.tonn_lastet / Math.max(1, lasting.tonn_totalt)) * 100 : 0;
  return (
    <section className={`panel ${s === 'S' ? 'kompakt' : ''}`}>
      <h3>Lastes nå</h3>
      {lasting ? (
        s === 'M' ? (
          <div className="ln-m">
            <div>
              <div className="feature">{lasting.skipsnavn}</div>
              <p className="muted">{Math.round(lasting.tonn_lastet)} av {Math.round(lasting.tonn_totalt)} tonn · {lasting.antall_steg} steg</p>
              <Progress value={lasting.tonn_lastet} max={lasting.tonn_totalt} />
              <a className="btn primary sm" href={`#/anlop/${lasting.id}`}>Åpne lasteplan</a>
            </div>
            <div className="ln-pct"><b>{Math.round(pct)}%</b><span>lastet</span></div>
          </div>
        ) : (
          <>
            <div className="feature">{lasting.skipsnavn}</div>
            <p className="muted">{Math.round(lasting.tonn_lastet)} av {Math.round(lasting.tonn_totalt)} tonn · {lasting.antall_steg} steg</p>
            <a className="btn primary sm wide" href={`#/anlop/${lasting.id}`}>Åpne lasteplan</a>
          </>
        )
      ) : (
        <>
          <div className="feature">Ingen båt lastes</div>
          <p className="muted">Start lasting fra et båtanløp.</p>
          <a className="btn primary sm wide" href="#/anlop">Gå til båtanløp</a>
        </>
      )}
    </section>
  );
}

function Batanlop({ s }: { s: Str }) {
  const { bater } = useDash();
  const vis = bater.slice(0, s === 'S' ? 3 : s === 'M' ? 6 : 8);
  return (
    <section className={`panel ${s === 'S' ? 'kompakt' : ''}`}>
      <h3>Båtanløp</h3>
      {vis.length === 0 && <p className="muted">Ingen båtanløp ennå. <a href="#/anlop?ny=1" className="nb-lenke">Opprett et →</a></p>}
      <ul className="list">
        {vis.map((b) => (
          <li key={b.id}>
            <a href={`#/anlop/${b.id}`}>
              <span className={`dot d-${b.status.toLowerCase()}`} />
              <span className="li-main">
                <b>{b.skipsnavn}</b>
                {s !== 'S' && <small>ETA {fmtDato(b.eta)}</small>}
                {s === 'L' && b.tonn_totalt > 0 && <Progress value={b.tonn_lastet} max={b.tonn_totalt} />}
              </span>
              {s === 'L' && b.tonn_totalt > 0 && <span className="muted li-tonn">{Math.round(b.tonn_lastet)}/{Math.round(b.tonn_totalt)} t</span>}
              <StatusPill status={b.status} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Beholdning({ s }: { s: Str }) {
  const { data } = useDash();
  const varer = s === 'S' ? data.varer.slice(0, 3) : data.varer;
  const liste = (
    <ul className="list roomy">
      {varer.length === 0 && <li className="muted">Ingen produkter ennå – opprett dem under <a href="#/admin" className="nb-lenke">Admin</a>.</li>}
      {varer.map((v) => (
        <li key={v.id}>
          <span className="salt-dot" style={{ background: v.fargekode }} />
          <span className="li-main"><b>{v.navn}</b>{s !== 'S' && <small>{v.produktnr} · {v.type === 'Bulk' ? 'bulk' : v.type === 'Bigbag' ? 'bigbag' : 'pall'}</small>}</span>
          <b className="li-r">{mengdeTekst(v.type, v.lager)}</b>
        </li>
      ))}
    </ul>
  );
  if (s === 'S') return <section className="panel kompakt"><h3>Beholdning</h3>{liste}</section>;
  return (
    <section className="panel">
      <h3>Beholdning (on-hand)</h3>
      <div className="bh-to">
        {liste}
        <table className="mini">
          <thead><tr><th>Periode</th><th className="num">Utlevert (t)</th></tr></thead>
          <tbody>
            {data.perioder.map((p) => (
              <tr key={p.dager}><td>{p.dager === 1 ? 'I dag' : `${p.dager} dager`}</td><td className="num">{p.tonn.toLocaleString('nb-NO')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Framdrift({ s }: { s: Str }) {
  const { bater } = useDash();
  const lasting = bater.find((b) => b.status === 'Lasting');
  const pct = lasting ? (lasting.tonn_lastet / Math.max(1, lasting.tonn_totalt)) * 100 : 0;
  if (s === 'S') {
    return (
      <section className="panel kompakt">
        <h3>Lasteframdrift</h3>
        <div className="fd-s"><b>{Math.round(pct)}%</b><span className="muted">{lasting ? `${Math.round(lasting.tonn_lastet)} / ${Math.round(lasting.tonn_totalt)} t` : 'Ingen lasting'}</span></div>
        <Progress value={pct} max={100} />
      </section>
    );
  }
  return (
    <section className="panel">
      <h3>Lasteframdrift</h3>
      <Gauge pct={pct} />
      <div className="legend"><span><i className="lg g" /> Lastet</span><span><i className="lg d" /> Gjenstår</span></div>
    </section>
  );
}

function NesteFrist({ s }: { s: Str }) {
  const { ko } = useDash();
  const now = useNow();
  const neste = ko[0];
  const rest = neste ? Math.max(0, new Date(neste.frist).getTime() - now) : 0;
  const hms = [Math.floor(rest / 3600000), Math.floor(rest / 60000) % 60, Math.floor(rest / 1000) % 60].map((x) => String(x).padStart(2, '0')).join(':');
  return (
    <section className={`panel dark tracker ${s === 'S' ? 'kompakt' : ''}`}>
      <h3>Neste lastebil-frist</h3>
      {neste ? (
        s === 'M' ? (
          <div className="nf-m">
            <div>
              <div className="clock">{hms}</div>
              <p>{neste.ordrenummer} · {neste.kunde}<br /><b>{neste.tonn} t {neste.salttype}</b></p>
            </div>
            <ul className="nf-liste">
              {ko.slice(1, 4).map((o) => (
                <li key={o.id}><span><b>{o.ordrenummer}</b> {o.kunde}</span><span>{o.tonn} t · {fristTekst(o.frist).tekst}</span></li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="clock">{hms}</div>
            <p>{neste.ordrenummer} · {neste.kunde}<br /><b>{neste.tonn} t {neste.salttype}</b></p>
          </>
        )
      ) : <div className="clock">—</div>}
    </section>
  );
}

// ---------- Register ----------
// Nye widgets legges bare til her: de dukker automatisk opp i «Legg til widget».

export const WIDGETS: WidgetDef[] = [
  { id: 'kpi-lager', tittel: 'Lager (bulk)', storrelser: { S: [3, 3] }, standard: 'S', komponent: KpiLager },
  { id: 'kpi-anlop', tittel: 'Aktive båtanløp', storrelser: { S: [3, 3] }, standard: 'S', komponent: KpiAnlop },
  { id: 'kpi-ordrer', tittel: 'Åpne lastebilordrer', storrelser: { S: [3, 3] }, standard: 'S', komponent: KpiOrdrer },
  { id: 'kpi-gjenstar', tittel: 'Gjenstår å laste', storrelser: { S: [3, 3] }, standard: 'S', komponent: KpiGjenstar },
  { id: 'produksjon', tittel: 'Utlevert tonn', beskrivelse: 'Utleverte tonn pr. dag (L: 30 dager)', storrelser: { S: [6, 3], M: [6, 6], L: [12, 6] }, standard: 'M', komponent: Produksjon },
  { id: 'lastes-na', tittel: 'Lastes nå', storrelser: { S: [3, 3], M: [6, 3] }, standard: 'S', komponent: LastesNa },
  { id: 'batanlop', tittel: 'Båtanløp', beskrivelse: 'Liste over anløp (L: med fremdrift)', storrelser: { S: [3, 3], M: [3, 6], L: [6, 6] }, standard: 'M', komponent: Batanlop },
  { id: 'beholdning', tittel: 'Beholdning (on-hand)', beskrivelse: 'Lager pr. produkt (M: med utlevert pr. periode)', storrelser: { S: [3, 3], M: [6, 6] }, standard: 'M', komponent: Beholdning },
  { id: 'framdrift', tittel: 'Lasteframdrift', storrelser: { S: [3, 3], M: [3, 6] }, standard: 'M', komponent: Framdrift },
  { id: 'neste-frist', tittel: 'Neste lastebil-frist', storrelser: { S: [3, 3], M: [6, 3] }, standard: 'S', komponent: NesteFrist },
  ...EKSTRA_WIDGETS,
];

export const def = (id: string) => WIDGETS.find((w) => w.id === id);

/** Standardoppsettet – bygget slik at alle rutene fylles helt uten hull. */
export const STANDARD: Plass[] = [
  { i: 'kpi-lager', s: 'S' }, { i: 'kpi-anlop', s: 'S' }, { i: 'kpi-ordrer', s: 'S' }, { i: 'kpi-gjenstar', s: 'S' },
  { i: 'produksjon', s: 'M' }, { i: 'lastes-na', s: 'S' }, { i: 'neste-frist', s: 'S' }, { i: 'framdrift', s: 'S' }, { i: 'bemanning', s: 'S' },
  { i: 'beholdning', s: 'M' }, { i: 'batanlop', s: 'M' }, { i: 'kaibok-siste', s: 'M' },
];

// ---------- Lagring (serveren lagrer {i,x,y,w,h}; rekkefølgen = y) ----------

export const tilServer = (l: Plass[]) =>
  l.flatMap((p, n) => {
    const m = def(p.i)?.storrelser[p.s];
    return m ? [{ i: p.i, x: 0, y: n, w: m[0], h: m[1] }] : [];
  });

export function fraServer(l: { i: string; x: number; y: number; w: number; h: number }[]): Plass[] {
  return [...l].sort((a, b) => a.y - b.y || a.x - b.x).flatMap((p) => {
    const d = def(p.i);
    if (!d) return [];
    // nærmeste standardstørrelse (gamle oppsett med vilkårlig størrelse tilpasses)
    const [s] = (Object.entries(d.storrelser) as [Str, Mål][]).sort((a, b) => Math.abs(a[1][0] - p.w) + Math.abs(a[1][1] - p.h) - (Math.abs(b[1][0] - p.w) + Math.abs(b[1][1] - p.h)))[0];
    return [{ i: p.i, s }];
  });
}
