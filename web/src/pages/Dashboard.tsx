import { useEffect, useState } from 'react';
import { useApi, fmtTonn, fmtDato, type Dashboard as D, type Bat, type SO } from '../api';
import { StatusPill } from '../ui';
import { IconArrow, IconPlus } from '../icons';

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

/** Halvsirkel-måler (SVG). */
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

export function Dashboard() {
  const { data } = useApi<D>('/dashboard');
  const { data: bater } = useApi<Bat[]>('/batanlop');
  const { data: ko } = useApi<SO[]>('/so-ko');
  const now = useNow();
  if (!data || !bater || !ko) return <p className="muted">Laster…</p>;

  const aktive = bater.filter((b) => b.status !== 'Ferdig');
  const lasting = bater.find((b) => b.status === 'Lasting');
  const gjenstar = aktive.reduce((s, b) => s + (b.tonn_totalt - b.tonn_lastet), 0);
  const dager = data.produksjonPerDag.slice(-7);
  const maks = Math.max(...dager.map((d) => d.bigbags));
  const minst = Math.min(...dager.map((d) => d.bigbags));
  const pct = lasting ? (lasting.tonn_lastet / Math.max(1, lasting.tonn_totalt)) * 100 : 0;
  const neste = ko[0];
  const rest = neste ? Math.max(0, new Date(neste.frist).getTime() - now) : 0;
  const hms = [Math.floor(rest / 3600000), Math.floor(rest / 60000) % 60, Math.floor(rest / 1000) % 60].map((x) => String(x).padStart(2, '0')).join(':');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Planlegg, prioriter og få båtene lastet uten dødtid.</p>
        </div>
        <div className="btns">
          <a className="btn primary" href="#/anlop"><IconPlus /> Nytt båtanløp</a>
          <a className="btn ghost" href="#/so-ko">Se SO-kø</a>
        </div>
      </div>

      <div className="kpis">
        <Kpi mork tittel="Lager (bulk)" verdi={fmtTonn(data.totalt.tonn_bulk).replace(' t', '')} sub={`${data.totalt.antall_bigbags.toLocaleString('nb-NO')} bigbags på lager`} href="#/" />
        <Kpi tittel="Aktive båtanløp" verdi={String(aktive.length)} sub={lasting ? `${lasting.skipsnavn} lastes nå` : 'Ingen lasting pågår'} href="#/anlop" />
        <Kpi tittel="Åpne lastebilordrer" verdi={String(ko.length)} sub={neste ? `Første frist ${fmtDato(neste.frist)}` : 'Køen er tom'} href="#/so-ko" />
        <Kpi tittel="Gjenstår å laste" verdi={String(Math.round(gjenstar))} sub={`tonn fordelt på ${aktive.filter((b) => b.antall_steg).length} båter`} href="#/anlop" />
      </div>

      <div className="grid-a">
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

        <section className="panel">
          <div className="row"><h3>Båtanløp</h3><a className="btn ghost sm" href="#/anlop"><IconPlus /> Ny</a></div>
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
      </div>

      <div className="grid-b">
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

        <section className="panel">
          <h3>Lasteframdrift</h3>
          <Gauge pct={pct} />
          <div className="legend"><span><i className="lg g" /> Lastet</span><span><i className="lg d" /> Gjenstår</span></div>
        </section>

        <section className="panel dark tracker">
          <h3>Neste lastebil-frist</h3>
          {neste ? (
            <>
              <div className="clock">{hms}</div>
              <p>{neste.ordrenummer} · {neste.kunde}<br /><b>{neste.tonn} t {neste.salttype}</b></p>
            </>
          ) : <div className="clock">—</div>}
        </section>
      </div>
    </>
  );
}
