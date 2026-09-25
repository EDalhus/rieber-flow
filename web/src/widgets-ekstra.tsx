import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { Str, WidgetDef } from './widgets';
import { useDash } from './dashctx';
import { api, dagStr, fmtDag, fmtDato, mengdeTekst, type Foering, type KalenderSvar, type Posisjon, type SO, useApi } from './api';
import { kartverketLag, skipIkon, terminalMarker } from './kart';
import { TERMINAL, etaTerminal, fmtNm, lastSjovei, sjovei, type Sjofelt } from './sjovei';
import { Progress, StatusPill } from './ui';

const kn = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(1).replace('.', ',')} kn`);
const leggTilDager = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function useNow(ms = 30000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

// ---------- Neste båt (mini-kart) ----------

/** Lite, ikke-interaktivt kart med båten, sjøveien og terminalen. */
function MiniKart({ pos, sti }: { pos: Posisjon; sti: [number, number][] }) {
  const el = useRef<HTMLDivElement>(null);
  const kart = useRef<L.Map | null>(null);
  const lag = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false }).setView([64, 12], 4);
    kartverketLag().addTo(m);
    terminalMarker().addTo(m);
    lag.current = L.layerGroup().addTo(m);
    kart.current = m;
    const ro = new ResizeObserver(() => { m.invalidateSize(); passa(); });
    ro.observe(el.current!);
    return () => { ro.disconnect(); m.remove(); kart.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const passa = () => {
    const m = kart.current;
    if (!m) return;
    const b = L.latLngBounds([[pos.lat, pos.lon], [TERMINAL.lat, TERMINAL.lon]]);
    m.fitBounds(b, { padding: [36, 36], maxZoom: 9, animate: false });
  };

  useEffect(() => {
    const g = lag.current!;
    g.clearLayers();
    if (sti.length > 1) L.polyline(sti, { color: '#145a3a', weight: 3, opacity: 0.85 }).addTo(g);
    L.marker([pos.lat, pos.lon], { icon: skipIkon(pos.heading ?? pos.cog ?? 0, true, (pos.sog ?? 0) > 0.5), interactive: false }).addTo(g);
    passa();
  }, [pos.lat, pos.lon, sti]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="nb-kart" />;
}

function NesteBat({ s }: { s: Str }) {
  const { bater } = useDash();
  const naa = useNow();
  // Neste planlagte anløp (ikke ferdig, ikke allerede til kai): tidligste ETA
  const neste = useMemo(
    () => [...bater].filter((b) => b.status === 'Ventet' || b.status === 'Ankommet').sort((a, b) => a.eta.localeCompare(b.eta))[0],
    [bater],
  );
  const [pos, setPos] = useState<Posisjon | null>(null);
  const [ingenNokkel, setIngenNokkel] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [felt, setFelt] = useState<Sjofelt | null>(null);
  const mmsi = neste?.mmsi ?? null;

  useEffect(() => { lastSjovei().then(setFelt).catch(() => {}); }, []);
  useEffect(() => {
    setPos(null); setFeil(null);
    if (!mmsi) return;
    let stopp = false;
    const hent = async () => {
      try {
        const r = await api<{ kilde: string; posisjon: Posisjon | null }>(`/ais/fartoy/${mmsi}`);
        if (stopp) return;
        setIngenNokkel(r.kilde === 'ingen');
        setPos(r.posisjon);
        setFeil(r.posisjon || r.kilde === 'ingen' ? null : 'Ingen nylig AIS-posisjon');
      } catch (e) { if (!stopp) setFeil((e as Error).message); }
    };
    hent();
    const t = setInterval(hent, 30000);
    return () => { stopp = true; clearInterval(t); };
  }, [mmsi]);

  const sj = useMemo(() => (felt && pos ? sjovei(felt, pos.lat, pos.lon) : null), [felt, pos]);

  if (!neste) {
    return <section className="panel"><h3>Neste båt til terminalen</h3><p className="muted">Ingen kommende anløp i Båtanløp-loggen.</p><a className="btn ghost sm" href="#/anlop?ny=1">Opprett anløp</a></section>;
  }
  const planlagt = new Date(neste.eta).getTime();
  const tilPlan = planlagt - naa;
  const om = tilPlan < 3600000 ? `${Math.max(1, Math.round(tilPlan / 60000))} min` : tilPlan < 172800000 ? `${Math.round(tilPlan / 3600000)} t` : `${Math.round(tilPlan / 86400000)} d`;
  const planTekst = `${fmtDato(neste.eta)} (${tilPlan < 0 ? `${Math.max(1, Math.round(-tilPlan / 3600000))} t forsinket` : `om ${om}`})`;
  const eta = sj && pos ? etaTerminal(sj.nm, pos.sog) : null;
  const avvikMin = eta && pos && sj && (pos.sog ?? 0) >= 0.5 ? Math.round(((naa + (sj.nm / pos.sog!) * 3600000) - planlagt) / 60000) : null;
  const avvikTekst = avvikMin != null && Math.abs(avvikMin) >= 10 ? `${Math.abs(avvikMin) >= 90 ? `${Math.round(Math.abs(avvikMin) / 60)} t` : `${Math.abs(avvikMin)} min`} ${avvikMin > 0 ? 'etter' : 'før'} plan` : 'i rute';

  const tall = mmsi && pos ? (
    <div className="nb-tall">
      <div><span>FART</span><b>{kn(pos.sog)}</b></div>
      <div><span>GJENSTÅR</span><b>{sj ? fmtNm(sj.nm) : '–'}</b></div>
      <div><span>TID IGJEN</span><b>{eta ? eta.varighet : (pos.sog ?? 0) < 0.5 ? 'stille' : '–'}</b></div>
    </div>
  ) : null;
  const etaLinje = eta && (
    <div className={`nb-eta ${avvikMin != null && avvikMin > 30 ? 'sen' : ''}`}>Ankomst ≈ {eta.klokka} · {avvikTekst}</div>
  );
  const tom = (
    <div className="nb-tom">
      {!mmsi ? (
        <>
          <p>Ikke koblet til AIS ennå – ingen posisjon.</p>
          <a className="btn primary sm" href={`#/anlop/${neste.id}?koble=1`}>Koble til AIS-fartøy</a>
        </>
      ) : ingenNokkel ? <p>AIS er ikke koblet til (mangler Barentswatch-nøkler).</p> : <p>{feil ?? 'Henter posisjon …'}</p>}
    </div>
  );

  const topp = (
    <>
      <div className="row">
        <h3>Neste båt til terminalen</h3>
        {mmsi && <a className="nb-lenke" href={`#/flate?ais=${mmsi}`}>Åpne i kart →</a>}
      </div>
      <div className="nb-navn"><b>{neste.skipsnavn}</b> <StatusPill status={neste.status} /></div>
      <div className="muted nb-plan">Planlagt {planTekst}</div>
    </>
  );

  if (s === 'S') {
    return <section className="panel nb kompakt">{topp}{tall ?? tom}{etaLinje}</section>;
  }
  if (s === 'L') {
    return (
      <section className="panel nb">
        {topp}
        {mmsi && pos ? (
          <div className="nb-l">
            <div className="nb-kartboks"><MiniKart pos={pos} sti={sj?.sti ?? []} /></div>
            <div className="nb-side">
              {tall}
              {etaLinje}
              <dl className="bk-rader nb-detalj">
                <dt>Planlagt ETA</dt><dd>{fmtDato(neste.eta)}</dd>
                <dt>Avvik</dt><dd>{avvikTekst}</dd>
                <dt>Kurs</dt><dd>{pos.cog != null ? `${Math.round(pos.cog)}°` : '–'}</dd>
                <dt>Destinasjon</dt><dd>{pos.destinasjon ?? '–'}</dd>
                <dt>Luftlinje</dt><dd>{sj ? fmtNm(sj.luftlinje) : '–'}</dd>
                <dt>MMSI</dt><dd>{mmsi}</dd>
              </dl>
            </div>
          </div>
        ) : tom}
      </section>
    );
  }
  return (
    <section className="panel nb">
      {topp}
      {mmsi && pos ? (
        <>
          <div className="nb-kartboks"><MiniKart pos={pos} sti={sj?.sti ?? []} /></div>
          {tall}
          {etaLinje}
        </>
      ) : tom}
    </section>
  );
}

// ---------- Bemanning ----------

function Bemanning({ s }: { s: Str }) {
  const idag = dagStr(new Date());
  const til = dagStr(leggTilDager(new Date(), 6));
  const { data } = useApi<KalenderSvar>(`/kalender?fra=${idag}&til=${til}`, 60000);
  if (!data) return <section className="panel"><h3>Bemanning</h3><p className="muted">Laster …</p></section>;
  const total = data.antallAnsatte;
  const dag = (d: string) => {
    const f = data.fravaer.filter((x) => x.dato_fra <= d && d <= x.dato_til);
    const borte = new Set(f.filter((x) => x.kategori !== 'Ikke overtid' && !x.tid_fra).map((x) => x.bruker_id));
    return { f: f.filter((x) => x.kategori !== 'Ikke overtid' || x.ikke_overtid), borte: borte.size };
  };
  const i = dag(idag);
  const imorgen = dag(dagStr(leggTilDager(new Date(), 1)));
  const uke = Array.from({ length: 7 }, (_, n) => dagStr(leggTilDager(new Date(), n)));
  const rad = (f: (typeof i.f)[number]) => (
    <li key={f.id}>
      <span className={`prikk ${f.kategori === 'Ikke overtid' ? 'p-overtid' : 'p-fravaer'}`} />
      <span className="li-main"><b>{f.navn}</b><small>{f.kategori}{f.tittel ? ` – ${f.tittel}` : ''} · {f.tid_fra ? `${f.tid_fra}–${f.tid_til}` : 'hele dagen'}</small></span>
      {f.ikke_overtid && f.kategori !== 'Ikke overtid' ? <span className="tagg">Ikke overtid</span> : null}
    </li>
  );
  const ukestripe = (
    <div className="bm-uke">
      {uke.map((d) => {
        const x = dag(d);
        const andel = (total - x.borte) / Math.max(1, total);
        return (
          <div key={d} className={`bm-dag ${x.borte === 0 ? '' : andel <= 0.5 ? 'lav' : 'middels'}`} title={`${fmtDag(d, 'lang')}: ${total - x.borte}/${total}`}>
            <span>{new Date(d + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'short' }).slice(0, 2)}</span>
            <b>{total - x.borte}</b>
          </div>
        );
      })}
    </div>
  );
  if (s === 'S') {
    return (
      <section className="panel kompakt">
        <div className="row"><h3>Bemanning i dag</h3><a className="nb-lenke" href="#/kalender">→</a></div>
        <div className="bm-topp"><b>{total - i.borte}</b><span>av {total} på jobb</span></div>
        <p className="muted bm-navn">{i.f.length ? i.f.map((f) => f.navn.split(' ')[0]).join(', ') + ' – fravær/ikke overtid' : 'Ingen fravær i dag'}</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="row"><h3>Bemanning i dag</h3><a className="nb-lenke" href="#/kalender">Kalender →</a></div>
      <div className="bm-topp"><b>{total - i.borte}</b><span>av {total} på jobb</span></div>
      {s === 'L' ? (
        <div className="bm-to">
          <div><div className="muted bm-kol">I dag</div><ul className="list bm-liste">{i.f.length === 0 && <li className="muted">Alle er på plass 🎉</li>}{i.f.slice(0, 6).map(rad)}</ul></div>
          <div><div className="muted bm-kol">I morgen</div><ul className="list bm-liste">{imorgen.f.length === 0 && <li className="muted">Ingen fravær</li>}{imorgen.f.slice(0, 6).map(rad)}</ul></div>
        </div>
      ) : (
        <ul className="list bm-liste">{i.f.length === 0 && <li className="muted">Alle er på plass 🎉</li>}{i.f.slice(0, 5).map(rad)}</ul>
      )}
      {ukestripe}
    </section>
  );
}

// ---------- Lager vs. åpne ordrer ----------

function LagerOrdre({ s }: { s: Str }) {
  const { data } = useDash();
  const { data: so } = useApi<SO[]>('/salgsordrer', 30000);
  const apne = (so ?? []).filter((x) => x.status !== 'Ferdig');
  const rader = data.varer.map((v) => {
    const ordrer = apne.filter((x) => x.linjer?.some((l) => l.produkt_id === v.id));
    const behov = ordrer.reduce((sum, x) => sum + (x.linjer ?? []).filter((l) => l.produkt_id === v.id).reduce((n, l) => n + l.antall, 0), 0);
    const forste = ordrer.map((x) => x.frist).sort()[0];
    return { v, behov, antall: ordrer.length, forste, mangler: Math.max(0, behov - v.lager) };
  });
  const vis = s === 'S' ? rader.slice(0, 3) : rader;
  return (
    <section className={`panel ${s === 'S' ? 'kompakt' : ''}`}>
      <h3>Lager mot åpne ordrer</h3>
      <div className="lo-liste">
        {vis.length === 0 && <p className="muted">Ingen produkter ennå – opprett dem under <a href="#/admin" className="nb-lenke">Admin</a>.</p>}
        {vis.map(({ v, behov, mangler, antall, forste }) => {
          const maks = Math.max(v.lager, behov, 1);
          return (
            <div key={v.id} className="lo-rad">
              <div className="row"><b>{v.navn}</b><span className={mangler ? 'haster' : 'muted'}>{mangler ? `Mangler ${mengdeTekst(v.type, mangler)}` : 'Dekket'}</span></div>
              <div className="lo-bar" title={`Lager ${mengdeTekst(v.type, v.lager)} · åpne ordrer ${mengdeTekst(v.type, behov)}`}>
                <div className="lo-lager" style={{ width: `${(v.lager / maks) * 100}%`, background: v.fargekode }} />
                <div className="lo-behov" style={{ left: `${(behov / maks) * 100}%` }} />
              </div>
              {s !== 'S' && <div className="muted lo-tekst">Lager {mengdeTekst(v.type, v.lager)} · bestilt {mengdeTekst(v.type, behov)}{s === 'L' ? ` · ${antall} åpne ordrer${forste ? ` · første frist ${fmtDag(forste.slice(0, 10))}` : ''}` : ''}</div>}
            </div>
          );
        })}
      </div>
      {s !== 'S' && vis.length > 0 && <p className="muted lo-note">Strek = åpne ordrer (lastebil og båt) som ikke er ferdige.</p>}
    </section>
  );
}

// ---------- Kaibok: siste anløp ----------

function KaibokSiste({ s }: { s: Str }) {
  const { data } = useApi<Foering[]>('/kaibok', 60000);
  if (!data) return <section className="panel"><h3>Kaibok</h3><p className="muted">Laster …</p></section>;
  const grense = dagStr(leggTilDager(new Date(), -90));
  const siste90 = data.filter((f) => f.kai_dato >= grense);
  const avvik = siste90.filter((f) => f.vurdering === 'Avvik').length;
  const antall = s === 'S' ? 1 : s === 'M' ? 5 : 6;
  return (
    <section className={`panel ${s === 'S' ? 'kompakt' : ''}`}>
      <div className="row"><h3>Siste anløp i kaiboken</h3><a className="nb-lenke" href="#/kaibok">{s === 'S' ? '→' : 'Kaibok →'}</a></div>
      <div className="kb-stat"><span><b>{siste90.length}</b> anløp siste 90 d</span><span className={avvik ? 'haster' : ''}><b>{avvik}</b> med avvik</span></div>
      <ul className="list kb-liste">
        {data.slice(0, antall).map((f) => (
          <li key={f.id}>
            <a href={`#/kaibok?id=${f.id}`}>
              <span className="li-main">
                <b>{f.baatnavn}</b>
                <small>{fmtDag(f.kai_dato)} · {f.operasjon} · {f.varetype}</small>
                {s === 'L' && f.tilbakemelding && <small className="kb-tekst">{f.tilbakemelding}</small>}
              </span>
              <span className={`vurd v-${f.vurdering.replace(/\s/g, '').toLowerCase()}`}>{f.vurdering}</span>
            </a>
          </li>
        ))}
        {data.length === 0 && <li className="muted">Ingen føringer ennå.</li>}
      </ul>
    </section>
  );
}

// ---------- Vær ----------

type VaerSvar = {
  oppdatert: string;
  na: { tid: string; temp: number; vind: number; retning: number; symbol: string | null; nedbor: number };
  timer: { tid: string; temp: number; vind: number; symbol: string | null; nedbor: number }[];
  hav: { na: { hoyde: number; retning: number }; timer: { tid: string; hoyde: number }[]; temp: number | null } | null;
};
const SYMBOL: [RegExp, string][] = [[/thunder/, '⛈️'], [/snow|sleet/, '🌨️'], [/rain|drizzle/, '🌧️'], [/fog/, '🌫️'], [/clearsky/, '☀️'], [/fair|partlycloudy/, '⛅'], [/cloudy/, '☁️']];
const symbol = (s: string | null) => (s ? SYMBOL.find(([r]) => r.test(s))?.[1] ?? '🌤️' : '🌤️');
const RETNING = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
const retningTekst = (g: number) => RETNING[Math.round(g / 45) % 8];

function Vaer({ s }: { s: Str }) {
  const { data, error } = useApi<VaerSvar>('/vaer', 300000);
  if (!data) return <section className="panel"><h3>Vær ved terminalen</h3><p className="muted">{error ?? 'Laster …'}</p></section>;
  const { na, hav } = data;
  const sterk = na.vind >= 14 || (hav?.na.hoyde ?? 0) >= 4;
  const timer = (n: number) => (
    <div className="vr-timer" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
      {data.timer.slice(1, n + 1).map((t) => (
        <div key={t.tid}><span>{new Date(t.tid).toLocaleTimeString('nb-NO', { hour: '2-digit', timeZone: 'Europe/Oslo' })}</span><i>{symbol(t.symbol)}</i><b>{Math.round(t.temp)}°</b><small>{Math.round(t.vind)} m/s</small></div>
      ))}
    </div>
  );
  const tall = (
    <div className="vr-tall">
      <div><span>VIND</span><b>{Math.round(na.vind)} m/s</b><small>fra {retningTekst(na.retning)}</small></div>
      {hav && <div><span>BØLGER</span><b>{hav.na.hoyde.toFixed(1).replace('.', ',')} m</b><small>utenfor kysten</small></div>}
      {hav?.temp != null && <div><span>SJØ</span><b>{Math.round(hav.temp)}°</b><small>temperatur</small></div>}
    </div>
  );
  const topp = (
    <div className="vr-topp">
      <span className="vr-symbol">{symbol(na.symbol)}</span>
      <div><b className="vr-temp">{Math.round(na.temp)}°</b><span className="muted">{na.nedbor > 0 ? ` ${na.nedbor} mm` : ' opphold'}</span></div>
    </div>
  );
  if (s === 'S') {
    return (
      <section className="panel vr kompakt">
        <h3>Vær ved terminalen</h3>
        <div className="vr-s">
          {topp}
          <div className="vr-s-tall"><span>💨 {Math.round(na.vind)} m/s {retningTekst(na.retning)}</span>{hav && <span>🌊 {hav.na.hoyde.toFixed(1).replace('.', ',')} m</span>}</div>
        </div>
        {sterk && <div className="vr-varsel">⚠️ Krevende forhold</div>}
      </section>
    );
  }
  if (s === 'L') {
    return (
      <section className="panel vr">
        <h3>Vær ved terminalen</h3>
        <div className="vr-l">
          <div>{topp}{tall}{sterk && <div className="vr-varsel">⚠️ Krevende forhold – vurder bulk-lasting og anløp</div>}</div>
          <div className="vr-l-timer">{timer(6)}<div className="muted vr-kilde">Kilde: MET Norway</div></div>
        </div>
      </section>
    );
  }
  return (
    <section className="panel vr">
      <h3>Vær ved terminalen</h3>
      {topp}
      {tall}
      {sterk && <div className="vr-varsel">⚠️ Krevende forhold – vurder bulk-lasting og anløp</div>}
      {timer(6)}
      <div className="muted vr-kilde">Kilde: MET Norway</div>
    </section>
  );
}

// ---------- Lasteplaner – fremdrift ----------

function Lasteplaner({ s }: { s: Str }) {
  const { bater } = useDash();
  const aktive = bater.filter((b) => b.antall_steg > 0 && b.status !== 'Ferdig');
  const tot = aktive.reduce((x, b) => x + b.tonn_totalt, 0);
  const lastet = aktive.reduce((x, b) => x + b.tonn_lastet, 0);
  if (s === 'S') {
    return (
      <section className="panel kompakt">
        <h3>Lasteplaner</h3>
        <div className="fd-s"><b>{aktive.length}</b><span className="muted">aktive planer · {Math.round(lastet)}/{Math.round(tot)} t</span></div>
        <Progress value={lastet} max={tot} />
      </section>
    );
  }
  return (
    <section className="panel">
      <h3>Lasteplaner</h3>
      <div className={`lp-liste ${s === 'L' ? 'to' : ''}`}>
        {aktive.length === 0 && <p className="muted">Ingen aktive lasteplaner.</p>}
        {aktive.map((b) => {
          const pct = (b.tonn_lastet / Math.max(1, b.tonn_totalt)) * 100;
          return (
            <a key={b.id} href={`#/anlop/${b.id}`} className="lp-rad">
              <div className="row"><b>{b.skipsnavn}</b><StatusPill status={b.status} /></div>
              <div className="progress"><div style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
              <div className="muted lp-tekst">{Math.round(b.tonn_lastet)} / {Math.round(b.tonn_totalt)} tonn · {b.antall_steg} steg · {Math.round(pct)} %</div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Hurtigvalg ----------

function Hurtigvalg({ s }: { s: Str }) {
  const knapper: [string, string, string][] = [
    ['📖', 'Ny føring', '#/kaibok?ny=1'],
    ['📅', 'Fravær', '#/kalender?nyttFravaer=1'],
    ['🚢', 'Nytt anløp', '#/anlop?ny=1'],
    ['📦', 'SO-kø', '#/so-ko'],
  ];
  return (
    <section className={`panel ${s === 'S' ? 'kompakt' : ''}`}>
      <h3>Hurtigvalg</h3>
      <div className={`hv-grid ${s === 'M' ? 'tre' : ''}`}>
        {knapper.map(([ikon, tekst, href]) => (
          <a key={href} href={href} className="hv-knapp"><span>{ikon}</span>{tekst}</a>
        ))}
        {s === 'M' && <button className="hv-knapp" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}><span>🔎</span>Søk i alt</button>}
      </div>
    </section>
  );
}

export const EKSTRA_WIDGETS: WidgetDef[] = [
  { id: 'neste-bat', tittel: 'Neste båt (kart)', beskrivelse: 'Neste planlagte anløp: fart, sjøvei og tid igjen (M/L: med kart)', storrelser: { S: [3, 3], M: [6, 6], L: [9, 6] }, standard: 'M', komponent: NesteBat },
  { id: 'bemanning', tittel: 'Bemanning i dag', beskrivelse: 'Hvem er på jobb, fravær og uken fremover', storrelser: { S: [3, 3], M: [3, 6], L: [6, 6] }, standard: 'S', komponent: Bemanning },
  { id: 'lager-ordre', tittel: 'Lager mot åpne ordrer', beskrivelse: 'Er det nok salt på lager til det som er bestilt?', storrelser: { S: [3, 3], M: [3, 6], L: [6, 6] }, standard: 'M', komponent: LagerOrdre },
  { id: 'kaibok-siste', tittel: 'Siste anløp i kaiboken', beskrivelse: 'Nyeste føringer og antall avvik', storrelser: { S: [3, 3], M: [3, 6], L: [6, 6] }, standard: 'M', komponent: KaibokSiste },
  { id: 'vaer', tittel: 'Vær ved terminalen', beskrivelse: 'Vind, bølger og timesprognose (MET Norway)', storrelser: { S: [3, 3], M: [3, 6], L: [6, 3] }, standard: 'M', komponent: Vaer },
  { id: 'lasteplaner', tittel: 'Lasteplaner', beskrivelse: 'Fremdrift for alle båter med lasteplan', storrelser: { S: [3, 3], M: [3, 6], L: [6, 3] }, standard: 'M', komponent: Lasteplaner },
  { id: 'hurtigvalg', tittel: 'Hurtigvalg', beskrivelse: 'Snarveier til vanlige oppgaver', storrelser: { S: [3, 3], M: [6, 3] }, standard: 'S', komponent: Hurtigvalg },
];
