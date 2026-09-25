import { useEffect, useMemo, useState } from 'react';
import { api, mengdeTekst, TYPE_NAVN, useApi, type Produkt, type ProduktType } from '../api';
import { IconPlus } from '../icons';
import { Modal } from '../ui';

type Svar = { kanEndre: boolean; produkter: Produkt[] };
const TYPER: ProduktType[] = ['Bulk', 'Bigbag', 'Pall'];
const FARGER = ['#1E6FFF', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#475569'];
const TYPE_TEKST: Record<ProduktType, string> = { Bulk: 'Bulk (tonn)', Bigbag: 'Bigbag', Pall: 'Pallevare' };

/** «40 × 25 kg» → { sekker: 40, kg: 25 } */
const lesPall = (p: Produkt) => {
  const m = p.enhet.match(/^(\d+)\s*[×x]\s*([\d.,]+)\s*kg$/i);
  return m ? { sekker: +m[1], kg: +m[2].replace(',', '.') } : { sekker: 1, kg: p.kg_per_enhet };
};

export function Admin() {
  const { data, reload } = useApi<Svar>('/admin/produkter', 0);
  const param = useMemo(() => new URLSearchParams(location.hash.split('?')[1] ?? ''), []);
  const [fane, setFane] = useState<'Alle' | ProduktType>('Alle');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ produkt?: Produkt; type?: ProduktType } | null>(null);
  const [apnet, setApnet] = useState(false);

  // Deep-lenker fra søket: #/admin?produkt=3 og #/admin?ny=1
  useEffect(() => {
    if (!data || apnet) return;
    setApnet(true);
    const id = param.get('produkt');
    if (id) { const p = data.produkter.find((x) => x.id === +id); if (p) setModal({ produkt: p }); }
    else if (param.get('ny')) setModal({});
  }, [data, apnet, param]);

  const liste = (data?.produkter ?? []).filter((p) => (fane === 'Alle' || p.type === fane) && (!q || `${p.navn} ${p.produktnr} ${p.beskrivelse}`.toLowerCase().includes(q.toLowerCase())));
  const antall = (t: 'Alle' | ProduktType) => (data?.produkter ?? []).filter((p) => t === 'Alle' || p.type === t).length;

  return (
    <>
      <div className="page-head">
        <div><h1>Admin</h1><p className="sub">Produktkatalog (SKU-er)</p></div>
        <div className="btns">
          {data?.kanEndre && <button className="btn primary" onClick={() => setModal({ type: fane === 'Alle' ? undefined : fane })}><IconPlus /> Nytt produkt</button>}
        </div>
      </div>

      {data && !data.kanEndre && <div className="info">Du har lesetilgang. Bare formann, kontor og ledelse kan endre produktkatalogen.</div>}

      <div className="card filtre">
        <div className="segment">
          {(['Alle', ...TYPER] as const).map((t) => (
            <button key={t} className={fane === t ? 'aktiv' : ''} onClick={() => setFane(t)}>{t === 'Alle' ? 'Alle' : TYPE_NAVN[t]} <span className="muted">{antall(t)}</span></button>
          ))}
        </div>
        <input className="f-sok" placeholder="Søk navn, produkt-ID eller beskrivelse" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card">
        <table className="kaibok-tabell">
          <thead><tr><th>Produkt-ID</th><th>Navn</th><th>Type</th><th>Pakking</th><th className="num">På lager</th><th>Status</th></tr></thead>
          <tbody>
            {liste.map((p) => (
              <tr key={p.id} className={data?.kanEndre ? 'klikk' : ''} onClick={() => data?.kanEndre && setModal({ produkt: p })}>
                <td><b>{p.produktnr}</b></td>
                <td>
                  <span className="prod-navn"><i className="salt-dot liten" style={{ background: p.fargekode }} /><span><b>{p.navn}</b>{p.beskrivelse && <small className="muted">{p.beskrivelse}</small>}</span></span>
                </td>
                <td><span className={`pill t-${p.type.toLowerCase()}`}>{TYPE_NAVN[p.type]}</span></td>
                <td>{p.type === 'Bulk' ? 'pr. tonn' : p.enhet}</td>
                <td className="num">{mengdeTekst(p.type, p.lager)}</td>
                <td>{p.aktiv ? <span className="pill s-ferdig">Aktiv</span> : <span className="pill">Deaktivert</span>}</td>
              </tr>
            ))}
            {data && liste.length === 0 && (
              <tr><td colSpan={6} className="muted">{data.produkter.length === 0 ? 'Ingen produkter ennå. Opprett bulk-, bigbag- og pallevarer med «Nytt produkt».' : 'Ingen treff.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && <ProduktModal start={modal} onLukk={(endret) => { setModal(null); if (endret) reload(); }} />}
    </>
  );
}

function ProduktModal({ start, onLukk }: { start: { produkt?: Produkt; type?: ProduktType }; onLukk: (endret: boolean) => void }) {
  const p = start.produkt;
  const pall = p?.type === 'Pall' ? lesPall(p) : { sekker: 40, kg: 25 };
  const [type, setType] = useState<ProduktType>(p?.type ?? start.type ?? 'Bulk');
  const [nr, setNr] = useState(p?.produktnr ?? '');
  const [navn, setNavn] = useState(p?.navn ?? '');
  const [beskrivelse, setBeskrivelse] = useState(p?.beskrivelse ?? '');
  const [farge, setFarge] = useState(p?.fargekode ?? FARGER[0]);
  const [kgBigbag, setKgBigbag] = useState(String(p?.type === 'Bigbag' ? p.kg_per_enhet : 1000));
  const [sekker, setSekker] = useState(String(pall.sekker));
  const [kgSekk, setKgSekk] = useState(String(pall.kg));
  const [lager, setLager] = useState(String(p?.lager ?? 0));
  const [aktiv, setAktiv] = useState(p ? !!p.aktiv : true);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const bruktIOrdre = (p?.antall_linjer ?? 0) > 0;

  const kg = type === 'Bulk' ? 1000 : type === 'Bigbag' ? +kgBigbag : +sekker * +kgSekk;
  const enhet = type === 'Bulk' ? 'tonn' : type === 'Bigbag' ? `${+kgBigbag} kg` : `${+sekker} × ${+kgSekk} kg`;
  const lagerEnhet = type === 'Bulk' ? 'tonn' : type === 'Bigbag' ? 'antall bigbags' : 'antall paller';

  async function lagre() {
    setLagrer(true); setFeil(null);
    const body = { produktnr: nr, navn, beskrivelse, type, enhet, kg_per_enhet: kg, fargekode: farge, lager: +lager || 0, aktiv };
    try {
      if (p) await api(`/admin/produkter/${p.id}`, 'PUT', body); else await api('/admin/produkter', 'POST', body);
      onLukk(true);
    } catch (e) { setFeil((e as Error).message); setLagrer(false); }
  }
  async function slett() {
    if (!p || !confirm(`Slette «${p.navn}»?`)) return;
    try { await api(`/admin/produkter/${p.id}`, 'DELETE'); onLukk(true); } catch (e) { setFeil((e as Error).message); }
  }

  return (
    <Modal tittel={p ? `Rediger ${p.navn}` : 'Nytt produkt'} onLukk={() => onLukk(false)} bred>
      {feil && <div className="error">{feil}</div>}
      <div className="vurd-valg" style={{ marginBottom: 12 }}>
        <span>Type</span>
        <div>
          {TYPER.map((t) => (
            <button key={t} type="button" className={`vurd type-valg ${type === t ? 'valgt' : ''}`} disabled={bruktIOrdre && t !== p?.type} onClick={() => setType(t)}>{TYPE_TEKST[t]}</button>
          ))}
        </div>
        {bruktIOrdre && <small className="muted">Produktet brukes i {p?.antall_linjer} ordrelinje(r) – type og vekt er låst.</small>}
      </div>

      <div className="skjema">
        <label>Produkt-ID / nummer<input value={nr} maxLength={40} onChange={(e) => setNr(e.target.value)} placeholder="F.eks. 1001 eller FRS-25" /></label>
        <label>Navn<input value={navn} maxLength={120} onChange={(e) => setNavn(e.target.value)} placeholder={type === 'Pall' ? 'F.eks. Nitrittsalt 25 kg' : 'F.eks. Fint raffinert salt'} /></label>
        <label className="bred">Beskrivelse
          <textarea rows={3} value={beskrivelse} maxLength={600} onChange={(e) => setBeskrivelse(e.target.value)} placeholder="Kort beskrivelse: bruksområde, kvalitet, kornstørrelse …" />
        </label>

        {type === 'Bulk' && <p className="muted bred">Bulk måles i <b>tonn</b> – både på lager og i ordrelinjer.</p>}
        {type === 'Bigbag' && (
          <label>Vekt pr. bigbag (kg)<input type="number" min="1" step="1" value={kgBigbag} disabled={bruktIOrdre} onChange={(e) => setKgBigbag(e.target.value)} /></label>
        )}
        {type === 'Pall' && (
          <>
            <label>Sekker pr. pall<input type="number" min="1" step="1" value={sekker} disabled={bruktIOrdre} onChange={(e) => setSekker(e.target.value)} /></label>
            <label>Vekt pr. sekk (kg)<input type="number" min="0.1" step="0.1" value={kgSekk} disabled={bruktIOrdre} onChange={(e) => setKgSekk(e.target.value)} /></label>
            <p className="muted bred">Pakking: <b>{enhet}</b> · {kg} kg pr. pall</p>
          </>
        )}
        <label>Lagerbeholdning ({lagerEnhet})<input type="number" min="0" step="any" value={lager} onChange={(e) => setLager(e.target.value)} /></label>

        <div className="bred farger">
          <span>Farge (brukes i ordrelister og i sjåførappen)</span>
          <div>
            {FARGER.map((f) => <button key={f} type="button" className={`farge ${farge.toUpperCase() === f ? 'valgt' : ''}`} style={{ background: f }} onClick={() => setFarge(f)} aria-label={f} />)}
            <input type="color" value={farge} onChange={(e) => setFarge(e.target.value.toUpperCase())} aria-label="Egendefinert farge" />
          </div>
        </div>
        {p && <label className="bred sjekk"><input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} /> Aktiv (deaktiverte produkter kan ikke velges i nye ordrer)</label>}
      </div>

      <div className="modal-bunn">
        {p && <button className="btn ghost danger" onClick={slett}>Slett</button>}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => onLukk(false)}>Avbryt</button>
        <button className="btn primary" disabled={lagrer || !nr.trim() || !navn.trim()} onClick={lagre}>{lagrer ? 'Lagrer…' : 'Lagre'}</button>
      </div>
    </Modal>
  );
}
