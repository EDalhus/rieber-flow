import { useApi, fmtTonn, type Dashboard as D, type Bat } from '../api';
import { Progress, StatusPill } from '../ui';

export function Dashboard() {
  const { data } = useApi<D>('/dashboard');
  const { data: bater } = useApi<Bat[]>('/batanlop');
  if (!data) return <p className="muted">Laster…</p>;
  const maks = Math.max(...data.produksjonPerDag.map((d) => d.bigbags));
  const lasting = bater?.find((b) => b.status === 'Lasting');

  return (
    <>
      <h1>Dashboard</h1>

      {lasting && (
        <a className="card live" href={`#/anlop/${lasting.id}`}>
          <div className="row">
            <b>🚢 {lasting.skipsnavn} lastes nå</b>
            <StatusPill status="Lasting" />
          </div>
          <Progress value={lasting.tonn_lastet} max={lasting.tonn_totalt} />
          <span className="muted">
            {Math.round(lasting.tonn_lastet)} / {Math.round(lasting.tonn_totalt)} tonn lastet
          </span>
        </a>
      )}

      <h2>On-hand (beholdning)</h2>
      <div className="grid3">
        {data.varer.map((v) => (
          <div key={v.id} className="card stock" style={{ borderTopColor: v.fargekode }}>
            <div className="stock-name">
              <i style={{ background: v.fargekode }} /> {v.salttype}
            </div>
            <div className="big">{fmtTonn(v.tonn_bulk)}</div>
            <div className="muted">bulk</div>
            <div className="big2">{v.antall_bigbags.toLocaleString('nb-NO')}</div>
            <div className="muted">bigbags</div>
          </div>
        ))}
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Produksjon og salg</h2>
          <table>
            <thead>
              <tr><th>Periode</th><th className="num">Bigbags produsert</th><th className="num">Solgt (tonn)</th></tr>
            </thead>
            <tbody>
              {data.perioder.map((p) => (
                <tr key={p.dager}>
                  <td>{p.dager === 1 ? 'I dag' : `${p.dager} dager`}</td>
                  <td className="num">{p.bigbags.toLocaleString('nb-NO')}</td>
                  <td className="num">{p.salgTonn.toLocaleString('nb-NO')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Bigbag-produksjon siste 30 dager</h2>
          <div className="bars">
            {data.produksjonPerDag.map((d) => (
              <div key={d.dato} title={`${d.dato}: ${d.bigbags}`} style={{ height: `${(d.bigbags / maks) * 100}%` }} />
            ))}
          </div>
          <div className="muted">Erstatter Excel-arket for månedlig bigbag-produksjon (mock-data).</div>
        </section>
      </div>
    </>
  );
}
