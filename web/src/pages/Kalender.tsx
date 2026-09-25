import { useMemo, useState } from 'react';
import { api, dagStr, fmtDag, KATEGORIER, pad2, useApi, type Fravaer, type KalAnlop, type KalenderSvar } from '../api';
import { IconPlus } from '../icons';
import { Modal } from '../ui';

const UKEDAGER = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
const leggTilDager = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mandagFor = (d: Date) => leggTilDager(d, -((d.getDay() + 6) % 7));
const dekker = (f: Fravaer, dag: string) => f.dato_fra <= dag && dag <= f.dato_til;
const tidTekst = (f: Fravaer) => (f.tid_fra ? `${f.tid_fra}–${f.tid_til}` : 'hele dagen');
const fornavn = (navn: string) => navn.split(' ')[0];

type Visning = 'mnd' | 'liste';

export function Kalender() {
  const idag = dagStr(new Date());
  const [visning, setVisning] = useState<Visning>('mnd');
  const param = useMemo(() => new URLSearchParams(location.hash.split('?')[1] ?? ''), []);
  const [mnd, setMnd] = useState(() => { const d = param.get('dato') ? new Date(param.get('dato') + 'T12:00:00') : new Date(); d.setDate(1); return d; });
  const [tidligere, setTidligere] = useState(false);
  const [visAnlop, setVisAnlop] = useState(true);
  const [visFravaer, setVisFravaer] = useState(true);
  const [bareMine, setBareMine] = useState(false);
  const [valgtDag, setValgtDag] = useState<string | null>(param.get('dato'));
  const [skjema, setSkjema] = useState<{ rediger?: Fravaer; dato?: string } | null>(param.get('nyttFravaer') ? {} : null);

  const start = mandagFor(mnd);
  const dager = useMemo(() => Array.from({ length: 42 }, (_, i) => dagStr(leggTilDager(start, i))), [mnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const fra = visning === 'mnd' ? dager[0] : dagStr(leggTilDager(new Date(), tidligere ? -90 : 0));
  const til = visning === 'mnd' ? dager[41] : dagStr(leggTilDager(new Date(), 180));
  const { data, reload } = useApi<KalenderSvar>(`/kalender?fra=${fra}&til=${til}`, 60000);

  const fravaer = (data?.fravaer ?? []).filter((f) => !bareMine || f.bruker_id === data?.meg);
  const anlop = data?.anlop ?? [];
  const total = data?.antallAnsatte ?? 0;

  /** Alt som gjelder én dag: anløp, fravær og bemanning. */
  const dagInfo = (dag: string) => {
    const a = anlop.filter((x) => x.dato === dag);
    const f = fravaer.filter((x) => dekker(x, dag));
    const borte = new Set(f.filter((x) => x.kategori !== 'Ikke overtid' && !x.tid_fra).map((x) => x.bruker_id));
    const delvis = new Set(f.filter((x) => x.kategori !== 'Ikke overtid' && x.tid_fra && !borte.has(x.bruker_id)).map((x) => x.bruker_id));
    const ingenOvertid = f.filter((x) => x.ikke_overtid);
    return { a, f, borte: borte.size, delvis: delvis.size, ingenOvertid, paJobb: total - borte.size };
  };

  const nyttFravaer = (dato?: string) => setSkjema({ dato });
  const lukkSkjema = (endret: boolean) => { setSkjema(null); if (endret) reload(); };
  const flytt = (n: number) => setMnd((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const mndTittel = mnd.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kalender</h1>
          <p className="sub">Anløp, fravær og bemanning</p>
        </div>
        <div className="btns">
          <button className="btn primary" onClick={() => nyttFravaer(valgtDag ?? idag)}><IconPlus /> Legg til fravær</button>
        </div>
      </div>

      <div className="card kal-verktoy">
        <div className="segment">
          <button className={visning === 'mnd' ? 'aktiv' : ''} onClick={() => setVisning('mnd')}>Måned</button>
          <button className={visning === 'liste' ? 'aktiv' : ''} onClick={() => setVisning('liste')}>Liste</button>
        </div>
        {visning === 'mnd' ? (
          <div className="kal-nav">
            <button className="icon" onClick={() => flytt(-1)} aria-label="Forrige måned">‹</button>
            <b className="mnd-tittel">{mndTittel}</b>
            <button className="icon" onClick={() => flytt(1)} aria-label="Neste måned">›</button>
            <button className="btn ghost sm" onClick={() => { const d = new Date(); d.setDate(1); setMnd(d); }}>I dag</button>
          </div>
        ) : (
          <label className="valg"><input type="checkbox" checked={tidligere} onChange={(e) => setTidligere(e.target.checked)} /> Vis siste 90 dager</label>
        )}
        <div className="kal-filtre">
          <label className="valg"><input type="checkbox" checked={visAnlop} onChange={(e) => setVisAnlop(e.target.checked)} /><i className="prikk p-anlop" /> Båtanløp</label>
          <label className="valg"><input type="checkbox" checked={visFravaer} onChange={(e) => setVisFravaer(e.target.checked)} /><i className="prikk p-fravaer" /> Fravær</label>
          <label className="valg"><input type="checkbox" checked={bareMine} onChange={(e) => setBareMine(e.target.checked)} /> Bare mitt</label>
        </div>
      </div>

      {!data ? <p className="muted">Laster…</p> : visning === 'mnd' ? (
        <div className="kal">
          {UKEDAGER.map((d) => <div key={d} className="kal-uke">{d}</div>)}
          {dager.map((dag) => {
            const info = dagInfo(dag);
            const annenMnd = dag.slice(0, 7) !== dagStr(mnd).slice(0, 7);
            const chips = [
              ...(visAnlop ? info.a.map((x) => ({ key: `a${x.type}${x.id}`, klasse: x.type === 'anlop' ? (x.status === 'Lasting' ? 'c-lasting' : 'c-anlop') : 'c-kaibok', tekst: `🚢 ${x.navn}` })) : []),
              ...(visFravaer ? info.f.map((x) => ({ key: `f${x.id}`, klasse: x.ikke_overtid && x.kategori === 'Ikke overtid' ? 'c-overtid' : 'c-fravaer', tekst: `${fornavn(x.navn)}${x.tid_fra ? ` ${x.tid_fra}` : ''}` })) : []),
            ];
            const helg = [5, 6].includes((new Date(dag + 'T12:00:00').getDay() + 6) % 7);
            return (
              <button key={dag} className={`kal-dag ${annenMnd ? 'annen' : ''} ${dag === idag ? 'idag' : ''} ${helg ? 'helg' : ''} ${dag === valgtDag ? 'valgt' : ''}`} onClick={() => setValgtDag(dag)}>
                <span className="kal-topp">
                  <b>{+dag.slice(8)}</b>
                  {visFravaer && (info.borte > 0 || info.delvis > 0) && (
                    <span className={`bemanning ${info.paJobb / Math.max(1, total) <= 0.5 ? 'lav' : info.borte > 0 ? 'middels' : ''}`} title={`${info.paJobb} av ${total} på jobb`}>
                      {info.paJobb}/{total}
                    </span>
                  )}
                </span>
                {chips.slice(0, 3).map((c) => <span key={c.key} className={`kal-chip ${c.klasse}`}>{c.tekst}</span>)}
                {chips.length > 3 && <span className="kal-mer">+{chips.length - 3} til</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <Liste dager={listeDager(fra, til, anlop, fravaer, visAnlop, visFravaer)} idag={idag} total={total} onDag={setValgtDag} />
      )}

      {valgtDag && data && !skjema && (
        <DagModal dag={valgtDag} info={dagInfo(valgtDag)} total={total} meg={data.meg} onLukk={() => setValgtDag(null)}
          onNy={() => nyttFravaer(valgtDag)} onRediger={(f) => setSkjema({ rediger: f })} onSlettet={reload} />
      )}
      {skjema && <FravaerModal start={skjema} onLukk={lukkSkjema} />}
    </>
  );
}

function listeDager(fra: string, til: string, anlop: KalAnlop[], fravaer: Fravaer[], visAnlop: boolean, visFravaer: boolean) {
  const ut: { dag: string; a: KalAnlop[]; f: Fravaer[] }[] = [];
  for (let d = new Date(fra + 'T12:00:00'); dagStr(d) <= til; d = leggTilDager(d, 1)) {
    const dag = dagStr(d);
    const a = visAnlop ? anlop.filter((x) => x.dato === dag) : [];
    const f = visFravaer ? fravaer.filter((x) => dekker(x, dag)) : [];
    if (a.length || f.length) ut.push({ dag, a, f });
  }
  return ut;
}

function Liste({ dager, idag, total, onDag }: { dager: ReturnType<typeof listeDager>; idag: string; total: number; onDag: (d: string) => void }) {
  if (dager.length === 0) return <div className="card muted">Ingen hendelser i perioden.</div>;
  return (
    <div className="agenda">
      {dager.map(({ dag, a, f }) => (
        <div key={dag} className={`agenda-dag ${dag === idag ? 'idag' : ''} ${dag < idag ? 'forbi' : ''}`}>
          <button className="agenda-dato" onClick={() => onDag(dag)}>
            <b>{fmtDag(dag, 'lang')}</b>{dag === idag && <span className="pill">I dag</span>}
          </button>
          <div className="agenda-rader">
            {a.map((x) => (
              <a key={`${x.type}${x.id}`} className="agenda-rad" href={x.href}>
                <i className={`prikk ${x.status === 'Lasting' && x.type === 'anlop' ? 'p-lasting' : 'p-anlop'}`} />
                <b>{x.navn}</b>
                <span className="muted">{x.type === 'anlop' ? `Ankomst ${x.tid ?? ''} · ${x.status}` : `${x.status} · ${x.varetype}`}</span>
              </a>
            ))}
            {f.map((x) => (
              <div key={x.id} className="agenda-rad">
                <i className={`prikk ${x.kategori === 'Ikke overtid' ? 'p-overtid' : 'p-fravaer'}`} />
                <b>{x.navn}</b>
                <span>{x.kategori}{x.tittel ? ` – ${x.tittel}` : ''}</span>
                <span className="muted">{tidTekst(x)}</span>
                {x.ikke_overtid && x.kategori !== 'Ikke overtid' ? <span className="tagg">Ikke overtid</span> : null}
              </div>
            ))}
          </div>
          <span className="muted agenda-bem">{total - new Set(f.filter((x) => x.kategori !== 'Ikke overtid' && !x.tid_fra).map((x) => x.bruker_id)).size}/{total} på jobb</span>
        </div>
      ))}
    </div>
  );
}

function DagModal({ dag, info, total, meg, onLukk, onNy, onRediger, onSlettet }: {
  dag: string; info: { a: KalAnlop[]; f: Fravaer[]; borte: number; delvis: number; ingenOvertid: Fravaer[]; paJobb: number };
  total: number; meg: number; onLukk: () => void; onNy: () => void; onRediger: (f: Fravaer) => void; onSlettet: () => void;
}) {
  const slett = async (f: Fravaer) => {
    if (!confirm('Slette denne føringen?')) return;
    await api('/fravaer/' + f.id, 'DELETE');
    onSlettet();
  };
  const overtidBlokk = [...new Set(info.ingenOvertid.map((f) => f.navn))];
  return (
    <Modal tittel={fmtDag(dag, 'lang')} onLukk={onLukk}>
      <div className={`bemanning-boks ${info.paJobb / Math.max(1, total) <= 0.5 ? 'lav' : info.borte ? 'middels' : ''}`}>
        <b>{info.paJobb} av {total} på jobb</b>
        <span>{info.borte ? `${info.borte} borte hele dagen` : 'Alle på plass'}{info.delvis ? ` · ${info.delvis} delvis borte` : ''}</span>
      </div>

      {overtidBlokk.length > 0 && (
        <div className="overtid-boks">🚫 Kan ikke jobbe overtid: <b>{overtidBlokk.join(', ')}</b></div>
      )}

      <h3>Båtanløp</h3>
      {info.a.length === 0 && <p className="muted">Ingen båtanløp denne dagen.</p>}
      {info.a.map((x) => (
        <a key={`${x.type}${x.id}`} className="agenda-rad" href={x.href} onClick={onLukk}>
          <i className="prikk p-anlop" /><b>{x.navn}</b>
          <span className="muted">{x.type === 'anlop' ? `Ankomst ${x.tid} · ${x.status}` : `Kaibok: ${x.status} · ${x.varetype}`}</span>
        </a>
      ))}

      <h3>Fravær og avtaler</h3>
      {info.f.length === 0 && <p className="muted">Ingen registrert.</p>}
      {info.f.map((f) => (
        <div key={f.id} className="agenda-rad">
          <i className={`prikk ${f.kategori === 'Ikke overtid' ? 'p-overtid' : 'p-fravaer'}`} />
          <span className="li-main"><b>{f.navn} <small className="muted">{f.rolle}</small></b>
            <small>{f.kategori}{f.tittel ? ` – ${f.tittel}` : ''} · {tidTekst(f)}{f.dato_fra !== f.dato_til ? ` · ${fmtDag(f.dato_fra)}–${fmtDag(f.dato_til)}` : ''}</small></span>
          {f.ikke_overtid && f.kategori !== 'Ikke overtid' ? <span className="tagg">Ikke overtid</span> : null}
          {f.bruker_id === meg && (
            <span className="rad-knapper">
              <button className="btn ghost sm" onClick={() => onRediger(f)}>Rediger</button>
              <button className="btn ghost sm danger" onClick={() => slett(f)}>Slett</button>
            </span>
          )}
        </div>
      ))}
      <div className="modal-bunn"><button className="btn primary" onClick={onNy}><IconPlus /> Legg til fravær</button></div>
    </Modal>
  );
}

function FravaerModal({ start, onLukk }: { start: { rediger?: Fravaer; dato?: string }; onLukk: (endret: boolean) => void }) {
  const r = start.rediger;
  const [kategori, setKategori] = useState<string>(r?.kategori ?? 'Lege/tannlege');
  const [tittel, setTittel] = useState(r?.tittel ?? '');
  const [fra, setFra] = useState(r?.dato_fra ?? start.dato ?? dagStr(new Date()));
  const [til, setTil] = useState(r?.dato_til ?? start.dato ?? dagStr(new Date()));
  const [heldag, setHeldag] = useState(r ? !r.tid_fra : false);
  const [tidFra, setTidFra] = useState(r?.tid_fra ?? '08:00');
  const [tidTil, setTidTil] = useState(r?.tid_til ?? '12:00');
  const [ikkeOvertid, setIkkeOvertid] = useState(!!r?.ikke_overtid);
  const [feil, setFeil] = useState<string | null>(null);
  const bare = kategori === 'Ikke overtid';

  async function lagre() {
    const body = {
      kategori, tittel, dato_fra: fra, dato_til: til < fra ? fra : til,
      tid_fra: heldag || bare ? null : tidFra, tid_til: heldag || bare ? null : tidTil, ikke_overtid: ikkeOvertid || bare,
    };
    try {
      if (r) await api('/fravaer/' + r.id, 'PUT', body);
      else await api('/fravaer', 'POST', body);
      onLukk(true);
    } catch (e) { setFeil((e as Error).message); }
  }

  return (
    <Modal tittel={r ? 'Rediger fravær' : 'Legg til fravær'} onLukk={() => onLukk(false)}>
      {feil && <div className="error">{feil}</div>}
      <p className="muted">Alle kollegaer ser dette i kalenderen og i bemanningen for dagen.</p>
      <div className="skjema">
        <label>Hva gjelder det?
          <select value={kategori} onChange={(e) => setKategori(e.target.value)}>{KATEGORIER.map((k) => <option key={k}>{k}</option>)}</select>
        </label>
        <label>Kort beskrivelse
          <input value={tittel} maxLength={120} onChange={(e) => setTittel(e.target.value)} placeholder="F.eks. Tannlege, leverer bil, planleggingsdag" />
        </label>
        <label>Fra dato<input type="date" value={fra} onChange={(e) => { setFra(e.target.value); if (til < e.target.value) setTil(e.target.value); }} /></label>
        <label>Til dato<input type="date" value={til} min={fra} onChange={(e) => setTil(e.target.value)} /></label>
        {!bare && (
          <>
            <label className="bred sjekk"><input type="checkbox" checked={heldag} onChange={(e) => setHeldag(e.target.checked)} /> Borte hele dagen</label>
            {!heldag && (
              <>
                <label>Fra klokken<input type="time" value={tidFra} onChange={(e) => setTidFra(e.target.value)} /></label>
                <label>Til klokken<input type="time" value={tidTil} onChange={(e) => setTidTil(e.target.value)} /></label>
              </>
            )}
          </>
        )}
        <label className="bred sjekk">
          <input type="checkbox" checked={ikkeOvertid || bare} disabled={bare} onChange={(e) => setIkkeOvertid(e.target.checked)} />
          Jeg kan ikke jobbe overtid {bare ? '(hele dagen)' : 'denne dagen'}
        </label>
      </div>
      <div className="modal-bunn">
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => onLukk(false)}>Avbryt</button>
        <button className="btn primary" onClick={lagre}>Lagre</button>
      </div>
    </Modal>
  );
}
