import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, dagStr, fmtDag, fmtTonn, mengdeTekst, TYPE_NAVN, useApi, type Bat, type Foering, type KaibokBaat, type Produkt, type Vurdering } from '../api';
import { IconPlus } from '../icons';
import { Modal, krympBilde } from '../ui';
import { gyldigImo } from '../imo';

const OPERASJONER = ['Lasting', 'Lossing'] as const;
const VURDERINGER: Vurdering[] = ['Bra', 'Merknad', 'Avvik', 'Ikke vurdert'];

const VurderingPill = ({ v }: { v: Vurdering }) => <span className={`vurd v-${v.replace(/\s/g, '').toLowerCase()}`}>{v}</span>;

/** Leser ?id= og ?baat= fra hash-en (f.eks. #/kaibok?id=5) så andre sider kan lenke hit. */
function hashParams() {
  const q = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q);
}

type Filter = { q: string; baat: string; operasjon: string; produkt: string; vurdering: string; fra: string; til: string };
const TOMT: Filter = { q: '', baat: '', operasjon: '', produkt: '', vurdering: '', fra: '', til: '' };

export function Kaibok() {
  const [filter, setFilter] = useState<Filter>(() => ({ ...TOMT, baat: hashParams().get('baat') ?? '' }));
  const [modal, setModal] = useState<{ id: number | null } | null>(() => {
    const id = hashParams().get('id');
    return id ? { id: +id } : hashParams().get('ny') ? { id: null } : null;
  });

  const sok = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => v && p.set(k, v));
    return p.toString();
  }, [filter]);
  const { data: liste, reload } = useApi<Foering[]>(`/kaibok?${sok}`, 0);
  const { data: baater, reload: lastBaater } = useApi<KaibokBaat[]>('/kaibok/baater', 0);
  const { data: produkter } = useApi<Produkt[]>('/produkter', 0);
  const oppdater = useCallback(() => { reload(); lastBaater(); }, [reload, lastBaater]);

  const sett = (k: keyof Filter, v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const aktive = Object.values(filter).some(Boolean);
  const baat = baater?.find((b) => b.baatnavn.toLowerCase() === filter.baat.toLowerCase());

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kaibok</h1>
          <p className="sub">Logg over anløp, tilbakemeldinger og bilder</p>
        </div>
        <div className="btns">
          <button className="btn primary" onClick={() => setModal({ id: null })}><IconPlus /> Ny føring</button>
        </div>
      </div>

      <div className="card filtre">
        <input className="f-sok" placeholder="Søk i båtnavn og tilbakemelding" value={filter.q} onChange={(e) => sett('q', e.target.value)} />
        <select value={filter.baat} onChange={(e) => sett('baat', e.target.value)}>
          <option value="">Alle båter</option>
          {baater?.map((b) => <option key={b.baatnavn} value={b.baatnavn}>{b.baatnavn} ({b.antall})</option>)}
        </select>
        <select value={filter.operasjon} onChange={(e) => sett('operasjon', e.target.value)}>
          <option value="">Lasting og lossing</option>
          {OPERASJONER.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select value={filter.produkt} onChange={(e) => sett('produkt', e.target.value)}>
          <option value="">Alle produkter</option>
          {(['Bulk', 'Bigbag', 'Pall'] as const).map((t) => (
            <optgroup key={t} label={TYPE_NAVN[t]}>{produkter?.filter((p) => p.type === t).map((p) => <option key={p.id} value={p.id}>{p.produktnr} · {p.navn}</option>)}</optgroup>
          ))}
        </select>
        <select value={filter.vurdering} onChange={(e) => sett('vurdering', e.target.value)}>
          <option value="">Alle vurderinger</option>
          {VURDERINGER.map((o) => <option key={o}>{o}</option>)}
        </select>
        <label className="f-dato">Fra <input type="date" value={filter.fra} onChange={(e) => sett('fra', e.target.value)} /></label>
        <label className="f-dato">Til <input type="date" value={filter.til} onChange={(e) => sett('til', e.target.value)} /></label>
        {aktive && <button className="btn ghost sm" onClick={() => setFilter(TOMT)}>Nullstill filtre</button>}
      </div>

      {baat && (
        <div className="baat-oppsummering">
          <b>{baat.baatnavn}</b>
          <span>{baat.antall} anløp</span>
          <span>Første: {fmtDag(baat.forste)}</span>
          <span>Siste: {fmtDag(baat.siste)}</span>
          <span className={baat.avvik ? 'avvik-tall' : ''}>{baat.avvik} med avvik</span>
        </div>
      )}

      <div className="card">
        <table className="kaibok-tabell">
          <thead>
            <tr><th>Dato til kai</th><th>Båt</th><th>Operasjon</th><th>Produkter</th><th className="num">Tonn</th><th>Vurdering</th><th className="num">Bilder</th></tr>
          </thead>
          <tbody>
            {liste?.map((f) => (
              <tr key={f.id} className="klikk" onClick={() => setModal({ id: f.id })}>
                <td>{fmtDag(f.kai_dato)}</td>
                <td>
                  <b>{f.baatnavn}</b>{f.imo && <small className="muted"> IMO {f.imo}</small>}{' '}
                  {(f.antall_anlop ?? 0) > 1 && (
                    <button className="chip liten" title="Vis alle anløp for denne båten" onClick={(e) => { e.stopPropagation(); sett('baat', f.baatnavn); }}>
                      {f.antall_anlop} anløp
                    </button>
                  )}
                </td>
                <td><span className={`pill op-${f.operasjon.toLowerCase()}`}>{f.operasjon}</span></td>
                <td>
                  {f.linjer && f.linjer.length > 0 ? (
                    <span className="prod-chips">{f.linjer.map((l) => <span key={l.id} className="prod-chip" title={l.produktnr}><i style={{ background: l.fargekode }} />{mengdeTekst(l.type, l.antall)} {l.produkt}</span>)}</span>
                  ) : <span className="muted">{f.varetype} (uten produkter)</span>}
                </td>
                <td className="num">{f.tonn != null ? fmtTonn(f.tonn) : '–'}</td>
                <td><VurderingPill v={f.vurdering} /></td>
                <td className="num">{f.antall_bilder ? `📷 ${f.antall_bilder}` : ''}</td>
              </tr>
            ))}
            {liste?.length === 0 && <tr><td colSpan={7} className="muted">Ingen føringer{aktive ? ' med disse filtrene' : ' ennå'}.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && <FoeringModal id={modal.id} onLukk={() => { setModal(null); oppdater(); }} />}
    </>
  );
}

// ---------- Opprett / vis / rediger én føring ----------

type Skjema = { baatnavn: string; imo: string; kai_dato: string; operasjon: string; vurdering: Vurdering; tilbakemelding: string; batanlop_id: number | null; mmsi: string | null };
type LinjeState = { produkt_id: number | ''; antall: string };

function FoeringModal({ id, onLukk }: { id: number | null; onLukk: () => void }) {
  const ny = id === null;
  const [s, setS] = useState<Skjema>({ baatnavn: '', imo: '', kai_dato: dagStr(new Date()), operasjon: 'Lossing', vurdering: 'Ikke vurdert', tilbakemelding: '', batanlop_id: null, mmsi: null });
  const [linjer, setLinjer] = useState<LinjeState[]>([{ produkt_id: '', antall: '' }]);
  const [info, setInfo] = useState<Foering | null>(null);
  const [bilder, setBilder] = useState<NonNullable<Foering['bilder']>>([]);
  const [nye, setNye] = useState<File[]>([]);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const filRef = useRef<HTMLInputElement>(null);
  const { data: bater } = useApi<Bat[]>('/batanlop', 0);
  const { data: kjente } = useApi<KaibokBaat[]>('/kaibok/baater', 0);
  const { data: aktive } = useApi<Produkt[]>('/produkter', 0);

  const last = useCallback(async () => {
    if (id === null) return;
    const f = await api<Foering>(`/kaibok/${id}`);
    setInfo(f);
    setBilder(f.bilder ?? []);
    setS({ baatnavn: f.baatnavn, imo: f.imo ?? '', kai_dato: f.kai_dato, operasjon: f.operasjon, vurdering: f.vurdering, tilbakemelding: f.tilbakemelding, batanlop_id: f.batanlop_id, mmsi: f.mmsi });
    setLinjer(f.linjer?.length ? f.linjer.map((l) => ({ produkt_id: l.produkt_id, antall: String(l.antall) })) : [{ produkt_id: '', antall: '' }]);
  }, [id]);
  useEffect(() => { last().catch((e) => setFeil((e as Error).message)); }, [last]);

  // Produktvalg: aktive produkter + evt. deaktiverte som allerede ligger i føringen
  const produkter = useMemo(() => {
    const m = new Map<number, Produkt>();
    (aktive ?? []).forEach((p) => m.set(p.id, p));
    (info?.linjer ?? []).forEach((l) => { if (!m.has(l.produkt_id)) m.set(l.produkt_id, { id: l.produkt_id, produktnr: l.produktnr, navn: l.produkt, beskrivelse: '', type: l.type, enhet: l.enhet, kg_per_enhet: l.kg_per_enhet, pallertype: l.pallertype, fargekode: l.fargekode, lager: l.lager, aktiv: l.aktiv }); });
    return [...m.values()];
  }, [aktive, info]);
  const prod = (pid: number | '') => produkter.find((p) => p.id === pid);
  const fortLager = ny || info?.lager_fort === 1;
  const fortegn = s.operasjon === 'Lossing' ? 1 : -1;
  // Lageret slik det er uten denne føringens gamle bevegelse (ved redigering)
  const gammelEffekt = (pid: number) => (!ny && info?.lager_fort === 1 ? (info.operasjon === 'Lossing' ? 1 : -1) * (info.linjer ?? []).filter((l) => l.produkt_id === pid).reduce((n, l) => n + l.antall, 0) : 0);
  const tonn = linjer.reduce((sum, l) => { const p = prod(l.produkt_id); return sum + (p ? ((+l.antall || 0) * p.kg_per_enhet) / 1000 : 0); }, 0);
  const sett = <K extends keyof Skjema>(k: K, v: Skjema[K]) => setS((x) => ({ ...x, [k]: v }));
  const settLinje = (i: number, d: Partial<LinjeState>) => setLinjer((l) => l.map((x, n) => (n === i ? { ...x, ...d } : x)));
  const gyldige = linjer.filter((l) => l.produkt_id !== '' && +l.antall > 0);
  const eldreUtenProdukter = !ny && (info?.linjer?.length ?? 0) === 0;

  const forhandsvisninger = useMemo(() => nye.map((f) => URL.createObjectURL(f)), [nye]);
  useEffect(() => () => forhandsvisninger.forEach(URL.revokeObjectURL), [forhandsvisninger]);

  const navnForslag = [...new Set([...(bater ?? []).map((b) => b.skipsnavn), ...(kjente ?? []).map((k) => k.baatnavn)])];

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      const body = { ...s, linjer: gyldige.map((l) => ({ produkt_id: l.produkt_id, antall: +l.antall })), varetype: info?.varetype, tonn: info?.tonn };
      const fid = ny ? (await api<{ id: number }>('/kaibok', 'POST', body)).id : (await api('/kaibok/' + id, 'PUT', body), id!);
      if (nye.length) {
        const skjema = new FormData();
        for (const f of nye) skjema.append('bilde', await krympBilde(f));
        const r = await fetch(`/api/kaibok/${fid}/bilder`, { method: 'POST', body: skjema });
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Opplasting av bilder feilet');
      }
      onLukk();
    } catch (e) {
      setFeil((e as Error).message);
      setLagrer(false);
      if (!ny) last().catch(() => {});
    }
  }

  const slett = async () => {
    if (!confirm(`Slette denne føringen og bildene?${fortLager && info?.linjer?.length ? ' Lagerbevegelsen reverseres.' : ''}`)) return;
    await api('/kaibok/' + id, 'DELETE');
    onLukk();
  };
  const slettBilde = async (bid: number) => {
    await api('/kaibok/bilder/' + bid, 'DELETE');
    setBilder((b) => b.filter((x) => x.id !== bid));
  };

  return (
    <Modal tittel={ny ? 'Ny kaibok-føring' : `${s.baatnavn || 'Føring'} · ${fmtDag(s.kai_dato)}`} onLukk={onLukk} bred>
      {feil && <div className="error">{feil}</div>}
      <div className="skjema">
        <label>Båtnavn
          <input list="baatnavn" required value={s.baatnavn} onChange={(e) => sett('baatnavn', e.target.value)} placeholder="F.eks. MV Nordic Star" />
          <datalist id="baatnavn">{navnForslag.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label>IMO-nummer (valgfritt)
          <input value={s.imo} inputMode="numeric" maxLength={7} onChange={(e) => sett('imo', e.target.value.replace(/\D/g, ''))} placeholder="7 siffer – identifiserer båten selv uten AIS" />
          {s.imo.length > 0 && !gyldigImo(s.imo) && <small className="haster">{s.imo.length === 7 ? 'Ugyldig kontrollsiffer' : 'IMO har 7 siffer'}</small>}
        </label>
        <label>Dato til kai<input type="date" value={s.kai_dato} onChange={(e) => sett('kai_dato', e.target.value)} /></label>
        <div className="vurd-valg">
          <span>Operasjon</span>
          <div>
            {OPERASJONER.map((o) => (
              <button key={o} type="button" className={`vurd type-valg ${s.operasjon === o ? 'valgt' : ''}`} onClick={() => sett('operasjon', o)}>{o === 'Lossing' ? '⬇ Lossing' : '⬆ Lasting'}</button>
            ))}
          </div>
          <small className="muted">{fortLager ? (s.operasjon === 'Lossing' ? 'Lossing legger varene til på lageret.' : 'Lasting trekker varene fra lageret.') : 'Lageret er allerede justert (lasting fra lasteplan) – endringer her påvirker ikke lageret.'}</small>
        </div>
      </div>

      <h3 className="topp-luft">Produkter</h3>
      {eldreUtenProdukter && <p className="muted">Eldre føring uten produkter – legg inn produktene for å få med lagerbevegelse og statistikk.</p>}
      {aktive?.length === 0 && <p className="muted">Ingen produkter i katalogen ennå – opprett dem først under <a href="#/admin" className="nb-lenke" onClick={onLukk}>Admin</a>.</p>}
      {linjer.map((l, i) => {
        const p = prod(l.produkt_id);
        const base = p ? p.lager - gammelEffekt(p.id) : 0;
        const etter = p ? base + (fortLager ? fortegn * (+l.antall || 0) : 0) : 0;
        return (
          <div key={i} className="ordre-linje">
            <select value={l.produkt_id} onChange={(e) => settLinje(i, { produkt_id: e.target.value ? +e.target.value : '' })}>
              <option value="">Velg produkt …</option>
              {(['Bulk', 'Bigbag', 'Pall'] as const).map((t) => (
                <optgroup key={t} label={TYPE_NAVN[t]}>
                  {produkter.filter((x) => x.type === t).map((x) => <option key={x.id} value={x.id}>{x.produktnr} · {x.navn}{t !== 'Bulk' ? ` (${x.enhet}${x.pallertype ? `, ${x.pallertype}` : ''})` : ''}</option>)}
                </optgroup>
              ))}
            </select>
            <div>
              <input type="number" min="0" step="any" value={l.antall} onChange={(e) => settLinje(i, { antall: e.target.value })} placeholder="Antall" style={{ width: '100%' }} />
              {p && (
                <div className={`enhet ${fortLager && etter < 0 ? 'haster' : ''}`}>
                  {p.type === 'Bulk' ? 'tonn' : p.type === 'Bigbag' ? 'bigbags' : 'paller'}
                  {fortLager && +l.antall > 0 ? ` · lager ${mengdeTekst(p.type, base)} → ${mengdeTekst(p.type, Math.max(0, etter))}${etter < 0 ? ' (rekker ikke)' : ''}` : ` · lager ${mengdeTekst(p.type, base)}`}
                </div>
              )}
            </div>
            <button type="button" className="icon" onClick={() => setLinjer((x) => (x.length > 1 ? x.filter((_, n) => n !== i) : [{ produkt_id: '', antall: '' }]))} title="Fjern linje">✕</button>
          </div>
        );
      })}
      <button type="button" className="btn ghost sm" onClick={() => setLinjer((x) => [...x, { produkt_id: '', antall: '' }])}><IconPlus /> Legg til produkt</button>
      <p className="muted" style={{ marginTop: 8 }}>Samlet vekt: <b>{fmtTonn(tonn)}</b></p>

      <div className="skjema" style={{ marginTop: 6 }}>
        <div className="vurd-valg">
          <span>Gikk alt bra?</span>
          <div>
            {VURDERINGER.map((v) => (
              <button key={v} type="button" className={`vurd v-${v.replace(/\s/g, '').toLowerCase()} ${s.vurdering === v ? 'valgt' : ''}`} onClick={() => sett('vurdering', v)}>{v}</button>
            ))}
          </div>
        </div>
        <label className="bred">Tilbakemelding om båten
          <textarea rows={4} value={s.tilbakemelding} onChange={(e) => sett('tilbakemelding', e.target.value)} placeholder="Hva gikk bra? Var det noe å merke seg – skader, forsinkelser, kvalitet på lasten?" />
        </label>
      </div>

      <h3 className="topp-luft">Bilder – dokumentasjon av kvalitet</h3>
      <div className="galleri">
        {bilder.map((b) => (
          <div key={b.id} className="bilde">
            <a href={`/api/kaibok/bilder/${b.id}`} target="_blank" rel="noreferrer"><img src={`/api/kaibok/bilder/${b.id}`} alt={b.filnavn} loading="lazy" /></a>
            <button className="icon" title="Slett bilde" onClick={() => slettBilde(b.id)}>✕</button>
          </div>
        ))}
        {forhandsvisninger.map((u, i) => (
          <div key={u} className="bilde ny">
            <img src={u} alt="Nytt bilde" />
            <button className="icon" title="Fjern" onClick={() => setNye((n) => n.filter((_, j) => j !== i))}>✕</button>
            <span className="merke">Ikke lagret</span>
          </div>
        ))}
        <button type="button" className="bilde legg-til" onClick={() => filRef.current?.click()}>＋<small>Legg til bilder</small></button>
        <input ref={filRef} type="file" accept="image/*" multiple hidden onChange={(e) => { setNye((n) => [...n, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      {info?.opprettet_av_navn && <p className="muted">Opprettet av {info.opprettet_av_navn}{info.batanlop_id ? ' · koblet til båtanløp' : ''}</p>}

      <div className="modal-bunn">
        {!ny && <button className="btn ghost danger" onClick={slett}>Slett</button>}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onLukk}>Avbryt</button>
        <button className="btn primary" disabled={lagrer || !s.baatnavn.trim() || (s.imo.length > 0 && !gyldigImo(s.imo)) || (gyldige.length === 0 && !eldreUtenProdukter)} onClick={lagre}>{lagrer ? 'Lagrer…' : 'Lagre'}</button>
      </div>
    </Modal>
  );
}
