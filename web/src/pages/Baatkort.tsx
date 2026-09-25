import { useEffect, useRef, useState } from 'react';
import { api, fmtDato, useApi, type FartoyBilde, type FartoyInfo, type FlateFartoy } from '../api';
import { etaTerminal, fmtNm, skipstypeTekst, type Sjovei } from '../sjovei';
import { krympBilde } from '../ui';

const kn = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(1).replace('.', ',')} kn`);

type Kontakt = 'tel' | 'mail' | undefined;
const FELT: [keyof FartoyInfo, string, Kontakt][] = [
  ['rederi', 'Rederi', undefined],
  ['kaptein_navn', 'Kaptein', undefined], ['kaptein_tlf', 'Kaptein mobil', 'tel'],
  ['chief_navn', 'Chief', undefined], ['chief_tlf', 'Chief mobil', 'tel'],
  ['epost', 'E-post', 'mail'],
  ['agent_navn', 'Agent', undefined], ['agent_tlf', 'Agent telefon', 'tel'],
  ['vhf_kanal', 'VHF-kanal', undefined], ['kapasitet', 'Kapasitet / lasterom', undefined],
];
const TOM: FartoyInfo = { rederi: '', kaptein_navn: '', kaptein_tlf: '', chief_navn: '', chief_tlf: '', epost: '', agent_navn: '', agent_tlf: '', vhf_kanal: '', kapasitet: '', bilde_url: '', notater: '', oppdatert: '', oppdatert_av_navn: null };

function Verdi({ v, type }: { v: string; type: Kontakt }) {
  if (!v) return <span className="muted">–</span>;
  if (type === 'tel') return <a className="kontakt-lenke" href={`tel:${v.replace(/[^\d+]/g, '')}`}>📞 {v}</a>;
  if (type === 'mail') return <a className="kontakt-lenke" href={`mailto:${v}`}>✉️ {v}</a>;
  return <>{v}</>;
}

/** Båtkort: bilde, live AIS-data, sjøvei til terminalen og felles kontaktinfo som teamet selv vedlikeholder. */
export function Baatkort({ f, sjo, onTilbake }: { f: FlateFartoy; sjo: Sjovei | null; onTilbake: () => void }) {
  const { data, reload } = useApi<{ info: FartoyInfo | null; bilder: FartoyBilde[] }>(`/fartoy/${f.mmsi}`, 0);
  const [redigerer, setRedigerer] = useState(false);
  const [skjema, setSkjema] = useState<FartoyInfo>(TOM);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(false);
  const filRef = useRef<HTMLInputElement>(null);
  const p = f.posisjon;

  useEffect(() => { setRedigerer(false); setFeil(null); }, [f.mmsi]);
  const info = data?.info ?? TOM;
  const bilder = data?.bilder ?? [];
  const hoved = bilder.find((b) => b.hoved) ?? bilder[0];
  const bildeSrc = hoved ? `/api/fartoy/bilder/${hoved.id}` : info.bilde_url || null;
  const eta = sjo && p ? etaTerminal(sjo.nm, p.sog) : null;

  async function lagre() {
    try { await api(`/fartoy/${f.mmsi}`, 'PUT', skjema); setRedigerer(false); setFeil(null); reload(); }
    catch (e) { setFeil((e as Error).message); }
  }
  async function lastOpp(filer: File[]) {
    setLaster(true); setFeil(null);
    try {
      const fd = new FormData();
      for (const fil of filer) fd.append('bilde', await krympBilde(fil));
      const r = await fetch(`/api/fartoy/${f.mmsi}/bilder`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Opplasting feilet');
      reload();
    } catch (e) { setFeil((e as Error).message); }
    setLaster(false);
  }

  return (
    <div className="baatkort">
      <button className="tilbake" onClick={onTilbake}>← Tilbake til flåten</button>

      <div className="bk-bilde">
        {bildeSrc ? <img src={bildeSrc} alt={f.navn} referrerPolicy="no-referrer" /> : (
          <div className="bk-ingen"><span>🚢</span><small>Ingen bilde ennå</small></div>
        )}
        <button className="bk-last" disabled={laster} onClick={() => filRef.current?.click()}>{laster ? 'Laster opp…' : '📷 Last opp bilde'}</button>
        <input ref={filRef} type="file" accept="image/*" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) lastOpp(l); }} />
      </div>
      {bilder.length > 1 && (
        <div className="bk-miniatyrer">
          {bilder.map((b) => (
            <div key={b.id} className={`mini ${b.id === hoved?.id ? 'hoved' : ''}`}>
              <img src={`/api/fartoy/bilder/${b.id}`} alt="" loading="lazy" onClick={async () => { await api(`/fartoy/bilder/${b.id}/hoved`, 'PUT'); reload(); }} title="Bruk som hovedbilde" />
              <button className="icon" title="Slett bilde" onClick={async () => { if (confirm('Slette bildet?')) { await api(`/fartoy/bilder/${b.id}`, 'DELETE'); reload(); } }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {bilder.length === 1 && (
        <button className="btn ghost sm" onClick={async () => { if (confirm('Slette bildet?')) { await api(`/fartoy/bilder/${bilder[0].id}`, 'DELETE'); reload(); } }}>Slett bilde</button>
      )}
      {bilder.length === 0 && !info.bilde_url && <p className="muted bk-notat">Kystverkets AIS-data har ingen bilder – last opp et eget bilde, så vises det her.</p>}

      <h3 className="bk-navn">{f.navn}</h3>
      <div className="bk-chips">
        <span className="chip-static">MMSI {f.mmsi}</span>
        {p?.imo && <span className="chip-static">IMO {p.imo}</span>}
        {p?.kallesignal && <span className="chip-static">{p.kallesignal}</span>}
        {skipstypeTekst(p?.skipstype) && <span className="chip-static">{skipstypeTekst(p?.skipstype)}</span>}
      </div>

      <div className="bk-terminal">
        <b>Til terminalen (Flatholmen)</b>
        {sjo ? (
          <>
            <div className="bk-stor">{fmtNm(sjo.nm)} <small>via sjø</small></div>
            <span className="muted">Luftlinje {fmtNm(sjo.luftlinje)} · estimert sjøvei langs kysten</span>
            {eta ? <span className="bk-eta">≈ {eta.varighet} ved {kn(p?.sog)} · ankomst {eta.klokka}</span> : <span className="muted">Ligger stille – ingen ETA</span>}
          </>
        ) : <span className="muted">{p ? 'Utenfor kartutsnittet for sjøvei-beregning' : 'Ingen posisjon'}</span>}
      </div>

      {p && (
        <dl className="bk-data">
          <dt>Fart</dt><dd>{kn(p.sog)}</dd>
          <dt>Kurs</dt><dd>{p.cog != null ? `${Math.round(p.cog)}°` : '–'}</dd>
          <dt>Destinasjon</dt><dd>{p.destinasjon ?? '–'}</dd>
          {p.eta && <><dt>ETA (AIS)</dt><dd>{fmtDato(p.eta)}</dd></>}
          {p.lengde != null && <><dt>Størrelse</dt><dd>{p.lengde} × {p.bredde ?? '–'} m</dd></>}
          {p.dypgang != null && <><dt>Dypgang</dt><dd>{p.dypgang} m</dd></>}
          {p.flagg && <><dt>Flagg</dt><dd>{p.flagg}</dd></>}
          {p.msgtime && <><dt>Sist oppdatert</dt><dd>{fmtDato(p.msgtime)}</dd></>}
        </dl>
      )}

      <div className="bk-kontakt">
        <div className="row">
          <h3>Kontakt og info</h3>
          {!redigerer && <button className="btn ghost sm" onClick={() => { setSkjema({ ...TOM, ...(data?.info ?? {}) }); setRedigerer(true); }}>Rediger</button>}
        </div>
        <p className="muted bk-notat">Felles for alle i teamet – legg inn det du selv hadde lyst til å finne.</p>
        {feil && <div className="error">{feil}</div>}
        {redigerer ? (
          <div className="bk-form">
            {FELT.map(([k, tittel, type]) => (
              <label key={k}>{tittel}
                <input value={skjema[k] as string} type={type === 'tel' ? 'tel' : type === 'mail' ? 'email' : 'text'} maxLength={300} onChange={(e) => setSkjema({ ...skjema, [k]: e.target.value })} />
              </label>
            ))}
            <label>Bilde-lenke (https, brukes hvis du ikke har lastet opp bilde)
              <input value={skjema.bilde_url} placeholder="https://…" onChange={(e) => setSkjema({ ...skjema, bilde_url: e.target.value })} />
            </label>
            <label>Notater
              <textarea rows={4} value={skjema.notater} maxLength={4000} onChange={(e) => setSkjema({ ...skjema, notater: e.target.value })} placeholder="F.eks. foretrukket kai, kontaktrutiner, spesielle krav …" />
            </label>
            <div className="modal-bunn">
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setRedigerer(false)}>Avbryt</button>
              <button className="btn primary" onClick={lagre}>Lagre</button>
            </div>
          </div>
        ) : (
          <>
            <dl className="bk-data">
              {FELT.map(([k, tittel, type]) => <><dt key={`t${k}`}>{tittel}</dt><dd key={`d${k}`}><Verdi v={info[k] as string} type={type} /></dd></>)}
            </dl>
            {info.notater && <div className="bk-notater">{info.notater}</div>}
            {info.oppdatert && <p className="muted bk-notat">Sist oppdatert {fmtDato(info.oppdatert.slice(0, 10))}{info.oppdatert_av_navn ? ` av ${info.oppdatert_av_navn}` : ''}</p>}
          </>
        )}
      </div>
    </div>
  );
}
