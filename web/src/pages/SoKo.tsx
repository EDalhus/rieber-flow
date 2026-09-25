import { useState } from 'react';
import { api, mengdeTekst, TYPE_NAVN, useApi, fmtTonn, fmtDato, fristTekst, type Produkt, type SO } from '../api';
import { IconPlus } from '../icons';
import { Linjer, Modal, linjeAntall, linjeProdukt, trengerKlargjoring } from '../ui';

export function SoKo() {
  const { data, reload } = useApi<SO[]>('/so-ko');
  const [ny, setNy] = useState(false);

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
      <div className="page-head">
        <div><h1>SO-kø</h1><p className="sub">Lastebilordrer på kortest frist</p></div>
        <div className="btns"><button className="btn primary" onClick={() => setNy(true)}><IconPlus /> Ny salgsordre</button></div>
      </div>
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
            {data?.length === 0 && <tr><td colSpan={6} className="muted">Ingen ventende ordrer. Opprett en med «Ny salgsordre» (produkter legges inn under Admin).</td></tr>}
          </tbody>
        </table>
      </div>
      {ny && <NyOrdre onLukk={(endret) => { setNy(false); if (endret) reload(); }} />}
    </>
  );
}

type Linje = { produkt_id: number | ''; antall: string };

function NyOrdre({ onLukk }: { onLukk: (endret: boolean) => void }) {
  const { data: produkter } = useApi<Produkt[]>('/produkter', 0);
  const [nr, setNr] = useState('');
  const [kunde, setKunde] = useState('');
  const [frist, setFrist] = useState('');
  const [linjer, setLinjer] = useState<Linje[]>([{ produkt_id: '', antall: '' }]);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const prod = (id: number | '') => produkter?.find((p) => p.id === id);
  const tonn = linjer.reduce((s, l) => { const p = prod(l.produkt_id); return s + (p ? ((+l.antall || 0) * p.kg_per_enhet) / 1000 : 0); }, 0);
  const sett = (i: number, d: Partial<Linje>) => setLinjer((l) => l.map((x, n) => (n === i ? { ...x, ...d } : x)));

  async function lagre() {
    setLagrer(true); setFeil(null);
    try {
      await api('/salgsordrer', 'POST', {
        ordrenummer: nr, kunde, frist: new Date(frist).toISOString(),
        linjer: linjer.filter((l) => l.produkt_id !== '').map((l) => ({ produkt_id: l.produkt_id, antall: +l.antall })),
      });
      onLukk(true);
    } catch (e) { setFeil((e as Error).message); setLagrer(false); }
  }

  return (
    <Modal tittel="Ny salgsordre" onLukk={() => onLukk(false)} bred>
      {feil && <div className="error">{feil}</div>}
      <div className="skjema">
        <label>Ordrenummer<input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="F.eks. SO-10080" /></label>
        <label>Kunde<input value={kunde} onChange={(e) => setKunde(e.target.value)} /></label>
        <label className="bred">Frist<input type="datetime-local" value={frist} onChange={(e) => setFrist(e.target.value)} /></label>
      </div>
      <h3 className="topp-luft">Produkter i ordren</h3>
      {produkter?.length === 0 && <p className="muted">Ingen produkter i katalogen ennå – opprett dem først under <a href="#/admin" className="nb-lenke" onClick={() => onLukk(false)}>Admin</a>.</p>}
      {linjer.map((l, i) => {
        const p = prod(l.produkt_id);
        return (
          <div key={i} className="ordre-linje">
            <select value={l.produkt_id} onChange={(e) => sett(i, { produkt_id: e.target.value ? +e.target.value : '' })}>
              <option value="">Velg produkt …</option>
              {(['Bulk', 'Bigbag', 'Pall'] as const).map((t) => (
                <optgroup key={t} label={TYPE_NAVN[t]}>
                  {produkter?.filter((x) => x.type === t).map((x) => <option key={x.id} value={x.id}>{x.produktnr} · {x.navn}{t !== 'Bulk' ? ` (${x.enhet})` : ''}</option>)}
                </optgroup>
              ))}
            </select>
            <div><input type="number" min="0" step="any" value={l.antall} onChange={(e) => sett(i, { antall: e.target.value })} placeholder="Antall" style={{ width: '100%' }} />
              {p && <div className="enhet">{p.type === 'Bulk' ? 'tonn' : p.type === 'Bigbag' ? 'bigbags' : 'paller'}{p.lager < +l.antall ? ` · lager ${mengdeTekst(p.type, p.lager)}` : ''}</div>}</div>
            <button type="button" className="icon" onClick={() => setLinjer((x) => (x.length > 1 ? x.filter((_, n) => n !== i) : x))} title="Fjern linje">✕</button>
          </div>
        );
      })}
      <button type="button" className="btn ghost sm" onClick={() => setLinjer((x) => [...x, { produkt_id: '', antall: '' }])}><IconPlus /> Legg til produkt</button>
      <p className="muted" style={{ marginTop: 10 }}>Samlet vekt: <b>{fmtTonn(tonn)}</b></p>

      <div className="modal-bunn">
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => onLukk(false)}>Avbryt</button>
        <button className="btn primary" disabled={lagrer || !nr.trim() || !kunde.trim() || !frist || tonn <= 0} onClick={lagre}>{lagrer ? 'Lagrer…' : 'Opprett ordre'}</button>
      </div>
    </Modal>
  );
}
