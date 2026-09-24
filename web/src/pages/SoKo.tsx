import { useApi, fmtTonn, fmtDato, fristTekst, type SO } from '../api';
import { SaltBadge } from '../ui';

export function SoKo() {
  const { data } = useApi<SO[]>('/so-ko');
  return (
    <>
      <h1>SO-kø</h1>
      <p className="muted">Lastebil-ordrer sortert automatisk på kortest frist.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>Ordre</th><th>Kunde</th><th>Salttype</th><th className="num">Tonn</th><th>Frist</th></tr>
          </thead>
          <tbody>
            {data?.map((s, i) => {
              const f = fristTekst(s.frist);
              return (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td><b>{s.ordrenummer}</b></td>
                  <td>{s.kunde}</td>
                  <td><SaltBadge salttype={s.salttype} farge={s.fargekode} /></td>
                  <td className="num">{fmtTonn(s.tonn)}</td>
                  <td className={f.haster ? 'haster' : ''}>{fmtDato(s.frist)} <span className="muted">({f.tekst})</span></td>
                </tr>
              );
            })}
            {data?.length === 0 && <tr><td colSpan={6} className="muted">Ingen ventende ordrer 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
