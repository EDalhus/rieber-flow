import { useApi, fmtTonn, fmtDato, fristTekst, type SO } from '../api';
import { Linjer, SaltBadge, linjeAntall, linjeProdukt, trengerKlargjoring } from '../ui';

export function SoKo() {
  const { data } = useApi<SO[]>('/so-ko');

  // Samlet plukkliste: alt som ikke er bulk, summert pr. produkt og emballasje
  const pluk = new Map<string, { tekst: string; produkt: string; antall: number; enhet: string }>();
  for (const so of data ?? []) {
    for (const l of so.linjer ?? []) {
      if (l.emballasje === 'Bulk') continue;
      const k = `${l.produkt}|${l.emballasje}|${l.enhet}`;
      const e = pluk.get(k) ?? { tekst: '', produkt: linjeProdukt(l), antall: 0, enhet: l.emballasje };
      e.antall += l.antall;
      e.tekst = linjeAntall({ ...l, antall: e.antall });
      pluk.set(k, e);
    }
  }

  return (
    <>
      <h1>SO-kø</h1>
      <p className="muted">Lastebil-ordrer sortert automatisk på kortest frist.</p>
      {pluk.size > 0 && (
        <div className="card">
          <h2>Må klargjøres / plukkes</h2>
          <ul className="linjer">
            {[...pluk.values()].map((p) => (
              <li key={p.produkt + p.enhet} className="pluk"><span className="l-ant">{p.tekst}</span><span className="l-prod">{p.produkt}</span></li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>Ordre</th><th>Kunde</th><th>Innhold</th><th className="num">Tonn</th><th>Frist</th></tr>
          </thead>
          <tbody>
            {data?.map((s, i) => {
              const f = fristTekst(s.frist);
              return (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td><b>{s.ordrenummer}</b></td>
                  <td>{s.kunde}</td>
                  <td>
                    <Linjer linjer={s.linjer} />
                    {trengerKlargjoring(s.linjer) && <span className="klar">Må klargjøres</span>}
                  </td>
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
