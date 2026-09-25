import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, useApi, type Bat, type FlateFartoy, type FlateSvar, type Posisjon } from '../api';
import { Baatkort } from './Baatkort';
import { TERMINAL, fmtNm, fmtVarighet, lastSjovei, punktFra, sjovei, type Sjofelt, type Sjovei } from '../sjovei';

const kn = (v: number | null) => (v == null ? '–' : `${v.toFixed(1).replace('.', ',')} kn`);
const ferdsel = (f: FlateFartoy) => (f.posisjon?.sog ?? 0) > 0.5;

const merke = (f: FlateFartoy) => `${f.navn} · ${kn(f.posisjon?.sog ?? null)}`;

const skipIkon = (rot: number, valgt: boolean, beveger: boolean, gjest = false) =>
  L.divIcon({
    className: 'ship-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg viewBox="0 0 34 34" style="transform:rotate(${rot}deg)"><path d="M17 3 L27 29 L17 24 L7 29 Z" fill="${gjest ? '#f59e0b' : valgt ? '#b9f26b' : beveger ? '#145a3a' : '#7a857f'}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  });

/** Kart over Norge (Kartverket) som bare viser fartøyene i brukerens flåte. */
function Kart({ fartoy, valgt, spor, rute, onVelg }: { fartoy: FlateFartoy[]; valgt: string | null; spor: [number, number][]; rute: [number, number][]; onVelg: (m: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const kart = useRef<L.Map | null>(null);
  const markorer = useRef(new Map<string, L.Marker>());
  const linje = useRef<L.Polyline | null>(null);
  const passet = useRef(false);
  const ringer = useRef<L.LayerGroup | null>(null);
  const ruteLinje = useRef<L.Polyline | null>(null);

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, attributionControl: true }).setView([64.5, 14], 4);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png', {
      maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/">Kartverket</a> · AIS: Kystverket via Barentswatch',
    }).addTo(m);
    L.marker([TERMINAL.lat, TERMINAL.lon], {
      icon: L.divIcon({ className: 'terminal-ikon', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div>⚓</div>' }), zIndexOffset: 500,
    }).bindTooltip(`Terminal · ${TERMINAL.navn}`, { direction: 'top', offset: [0, -14] }).addTo(m);
    ringer.current = L.layerGroup().addTo(m);
    kart.current = m;
    return () => { m.remove(); kart.current = null; markorer.current.clear(); };
  }, []);

  // Marker for hvert fartøy i flåten – ingen andre
  useEffect(() => {
    const m = kart.current!;
    const na = new Set<string>();
    const punkter: [number, number][] = [];
    for (const f of fartoy) {
      const p = f.posisjon;
      if (!p) continue;
      na.add(f.mmsi);
      punkter.push([p.lat, p.lon]);
      const ikon = skipIkon(p.heading ?? p.cog ?? 0, f.mmsi === valgt, ferdsel(f), f.gjest);
      let mk = markorer.current.get(f.mmsi);
      if (!mk) {
        mk = L.marker([p.lat, p.lon], { icon: ikon, riseOnHover: true }).addTo(m);
        mk.bindTooltip(merke(f), { permanent: true, direction: 'right', offset: [12, 0], className: 'ship-label' });
        mk.on('click', () => onVelg(f.mmsi));
        markorer.current.set(f.mmsi, mk);
      } else { mk.setLatLng([p.lat, p.lon]); mk.setIcon(ikon); mk.setTooltipContent(merke(f)); }
      mk.setZIndexOffset(f.mmsi === valgt ? 1000 : 0);
    }
    for (const [mmsi, mk] of markorer.current) if (!na.has(mmsi)) { mk.remove(); markorer.current.delete(mmsi); }
    if (!passet.current && punkter.length) { m.fitBounds(L.latLngBounds(punkter).pad(0.4), { maxZoom: 7 }); passet.current = true; }
  }, [fartoy, valgt, onVelg]);

  // Spor siste 24 t for valgt fartøy
  useEffect(() => {
    linje.current?.remove();
    linje.current = spor.length > 1 ? L.polyline(spor, { color: '#7a857f', weight: 2.5, dashArray: '4 7', opacity: 0.9 }).addTo(kart.current!) : null;
  }, [spor]);

  // Ringer rundt valgt båt: hvor langt den kommer på 15 min, 30 min, 1 t og 2 t ved gjeldende fart
  const valgtPos = fartoy.find((f) => f.mmsi === valgt)?.posisjon ?? null;
  useEffect(() => {
    const g = ringer.current!;
    g.clearLayers();
    if (!valgtPos) return;
    const beveger = (valgtPos.sog ?? 0) >= 1;
    const ringDef: { nm: number; tekst: string }[] = beveger
      ? [15, 30, 60, 120].map((min) => ({ nm: (valgtPos.sog! * min) / 60, tekst: `${fmtVarighet(min / 60)} · ${fmtNm((valgtPos.sog! * min) / 60)}` }))
      : [1, 3, 6, 12].map((nm) => ({ nm, tekst: fmtNm(nm) }));
    ringDef.forEach((r, n) => {
      L.circle([valgtPos.lat, valgtPos.lon], { radius: r.nm * 1852, color: '#145a3a', weight: 1.5, dashArray: '5 6', fill: false, opacity: 0.8, interactive: false }).addTo(g);
      const [lat, lon] = punktFra(valgtPos.lat, valgtPos.lon, 40 + (n % 2) * 12, r.nm);
      L.marker([lat, lon], { interactive: false, icon: L.divIcon({ className: 'ring-label', html: `<span>${r.tekst}</span>`, iconSize: [0, 0] }) }).addTo(g);
    });
  }, [valgtPos?.lat, valgtPos?.lon, valgtPos?.sog]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom til 2-timersringen når man velger en båt
  useEffect(() => {
    if (!valgtPos) return;
    const nm = (valgtPos.sog ?? 0) >= 1 ? Math.max(6, valgtPos.sog! * 2) : 12;
    const hjorner = [0, 90, 180, 270].map((b) => punktFra(valgtPos.lat, valgtPos.lon, b, nm));
    kart.current?.fitBounds(L.latLngBounds(hjorner), { padding: [30, 30], maxZoom: 10, animate: true });
  }, [valgt, valgtPos == null]); // eslint-disable-line react-hooks/exhaustive-deps  (zoom når båten velges, eller når posisjonen først dukker opp)

  // Sjøveien til terminalen
  useEffect(() => {
    ruteLinje.current?.remove();
    ruteLinje.current = rute.length > 1 ? L.polyline(rute, { color: '#0d3b26', weight: 3, opacity: 0.85 }).addTo(kart.current!) : null;
  }, [rute]);

  return <div ref={el} className="kart" />;
}

export function Flate() {
  const { data, reload } = useApi<FlateSvar>('/flate', 30000);
  const { data: bater } = useApi<Bat[]>('/batanlop', 0);
  const [valgt, setValgt] = useState<string | null>(() => { const q = new URLSearchParams(location.hash.split('?')[1] ?? ''); return q.get('mmsi') ?? q.get('ais'); });
  const [spor, setSpor] = useState<[number, number][]>([]);
  const [q, setQ] = useState('');
  const [treff, setTreff] = useState<{ mmsi: string; imo: string | null; navn: string }[]>([]);
  const [feil, setFeil] = useState<string | null>(null);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [felt, setFelt] = useState<Sjofelt | null>(null);
  const [gjest, setGjest] = useState<FlateFartoy | null>(null);
  const [gjestFeil, setGjestFeil] = useState<string | null>(null);
  const [aisParam, setAisParam] = useState<string | null>(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('ais'));
  const [sorter, setSorter] = useState<'standard' | 'naermest'>('standard');

  useEffect(() => { lastSjovei().then(setFelt).catch(() => {}); }, []);

  // Søkt frem fra ⌘K: hent posisjonen til en båt utenfor flåten, vis den på kartet og hold den oppdatert
  useEffect(() => {
    if (!aisParam) return;
    let avbrutt = false;
    const hent = async () => {
      try {
        const r = await api<{ posisjon: Posisjon | null }>(`/ais/fartoy/${aisParam}`);
        if (avbrutt) return;
        if (!r.posisjon) { setGjestFeil('Fant ingen nylig AIS-posisjon for denne båten (den kan ligge utenfor dekningsområdet eller ha slått av AIS).'); setGjest((g) => g); return; }
        setGjestFeil(null);
        setGjest({ mmsi: aisParam, navn: r.posisjon.navn ?? `MMSI ${aisParam}`, posisjon: r.posisjon, gjest: true });
      } catch (e) { if (!avbrutt) setGjestFeil((e as Error).message); }
    };
    hent();
    const t = setInterval(hent, 30000);
    return () => { avbrutt = true; clearInterval(t); };
  }, [aisParam]);
  // Sjøvei til terminalen for hver båt i flåten (forhåndsberegnet felt – ingen serverkall)
  const sjoMap = useMemo(() => {
    const m = new Map<string, Sjovei | null>();
    if (felt && data) for (const f of [...data.fartoy, ...(gjest ? [gjest] : [])]) if (f.posisjon) m.set(f.mmsi, sjovei(felt, f.posisjon.lat, f.posisjon.lon));
    return m;
  }, [felt, data, gjest]);

  useEffect(() => {
    if (!valgt) { setSpor([]); return; }
    api<{ lat: number; lon: number }[]>(`/ais/spor/${valgt}`).then((s) => setSpor(s.map((p) => [p.lat, p.lon]))).catch(() => setSpor([]));
  }, [valgt]);

  useEffect(() => {
    if (q.trim().length < 2) { setTreff([]); return; }
    const t = setTimeout(() => {
      api<{ treff: { mmsi: string; imo: string | null; navn: string }[] }>(`/ais/sok?q=${encodeURIComponent(q)}`)
        .then((r) => { setTreff(r.treff); setFeil(null); })
        .catch((e) => setFeil((e as Error).message));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (!data) return <p className="muted">Laster…</p>;
  const iFlate = new Set(data.fartoy.map((f) => f.mmsi));
  const leggTil = async (mmsi: string, navn: string) => { await api('/flate', 'POST', { mmsi, navn }); setQ(''); reload(); };
  const fjern = async (mmsi: string) => { await api(`/flate/${mmsi}`, 'DELETE'); if (valgt === mmsi) setValgt(null); reload(); };
  const fraAnlop = (bater ?? []).filter((b) => b.mmsi && !iFlate.has(b.mmsi));
  // En søkt båt vises som «gjest» på kartet til den legges i flåten eller lukkes
  const alle = gjest && !iFlate.has(gjest.mmsi) ? [...data.fartoy, gjest] : data.fartoy;
  const valgtF = alle.find((f) => f.mmsi === valgt);
  const lukk = () => { setValgt(null); setGjest(null); setAisParam(null); setGjestFeil(null); };
  const leggGjestTilFlate = async () => { if (!gjest) return; await leggTil(gjest.mmsi, gjest.navn); setGjest(null); setAisParam(null); };
  const rute = valgt ? sjoMap.get(valgt)?.sti ?? [] : [];
  const sortert = sorter === 'naermest'
    ? [...data.fartoy].sort((a, b) => (sjoMap.get(a.mmsi)?.nm ?? Infinity) - (sjoMap.get(b.mmsi)?.nm ?? Infinity))
    : data.fartoy;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Flåte & kart</h1>
          <p className="sub">Bare båtene i flåten din vises på kartet – ingen annen trafikk.</p>
        </div>
        <span className={`kilde ${data.kilde}`}>{data.kilde === 'ais' ? '● Live AIS · Kystverket' : '◌ Simulerte posisjoner'}</span>
      </div>
      {data.kilde === 'simulert' && (
        <div className="info">Ingen Barentswatch-nøkkel er satt, så posisjonene er simulert. Sett <code>BARENTSWATCH_CLIENT_ID</code> og <code>BARENTSWATCH_CLIENT_SECRET</code> for ekte AIS-data (se README).</div>
      )}
      {data.kilde === 'ais' && data.fartoy.length > 0 && data.fartoy.every((f) => !f.posisjon) && !data.feil && (
        <div className="info">Live AIS er på, men ingen av båtene i flåten har posisjon. Demo-båtene har plassholder-MMSI – fjern dem og søk opp ekte fartøy under «Legg til båt».</div>
      )}
      <div className="diag">
        <button className="btn ghost sm" onClick={async () => setDiag(await api<Record<string, unknown>>('/ais/status').catch((e) => ({ konklusjon: (e as Error).message })))}>Test AIS-tilkobling</button>
        {diag && (
          <pre>{JSON.stringify(diag, null, 2)}</pre>
        )}
      </div>
      {(data.feil || feil) && <div className="error">{data.feil ?? feil}</div>}
      {gjestFeil && <div className="info">{gjestFeil}</div>}

      <div className="flate-grid">
        <div className="kart-wrap"><Kart fartoy={alle} valgt={valgt} spor={spor} rute={rute} onVelg={setValgt} /></div>

        <aside className="panel flate-panel">
         {valgtF ? <Baatkort f={valgtF} sjo={sjoMap.get(valgtF.mmsi) ?? null} onTilbake={lukk} gjest={!!valgtF.gjest} onLeggTil={leggGjestTilFlate} /> : (<>
          <div className="row"><h3>Min flåte <span className="muted">· {data.fartoy.length} båter</span></h3>
            <select className="sorter" value={sorter} onChange={(e) => setSorter(e.target.value as 'standard' | 'naermest')}>
              <option value="standard">Rekkefølge</option><option value="naermest">Nærmest terminalen</option>
            </select></div>
          <ul className="list flate-liste">
            {sortert.map((f) => (
              <li key={f.mmsi} className={f.mmsi === valgt ? 'valgt' : ''}>
                <button className="flate-rad" onClick={() => setValgt(f.mmsi)}>
                  <span className={`dot ${f.posisjon ? (ferdsel(f) ? 'd-ankommet' : 'd-lasting') : ''}`} />
                  <span className="li-main">
                    <b>{f.navn}</b>
                    <small>
                      {f.posisjon
                        ? `${kn(f.posisjon.sog)}${sjoMap.get(f.mmsi) ? ` · ${fmtNm(sjoMap.get(f.mmsi)!.nm)} til terminalen` : ''}${f.posisjon.destinasjon ? ` · → ${f.posisjon.destinasjon}` : ''}`
                        : 'Ingen AIS-posisjon'}
                    </small>
                  </span>
                </button>
                <button className="icon" title="Fjern fra flåten" onClick={() => fjern(f.mmsi)}>✕</button>
              </li>
            ))}
            {data.fartoy.length === 0 && <li className="muted">Flåten er tom – legg til båter under.</li>}
          </ul>

          <h3 className="topp-luft">Legg til båt</h3>
          <input className="wide-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk skipsnavn, IMO- eller MMSI-nummer" />
          <ul className="list treff">
            {treff.map((t) => (
              <li key={t.mmsi}>
                <span className="li-main"><b>{t.navn}</b><small>{t.imo ? `IMO ${t.imo} · ` : ''}MMSI {t.mmsi}</small></span>
                {iFlate.has(t.mmsi) ? <span className="muted">I flåten</span> : <button className="btn ghost sm" onClick={() => leggTil(t.mmsi, t.navn)}>+ Legg til</button>}
              </li>
            ))}
            {q.trim().length >= 2 && treff.length === 0 && !feil && <li className="muted">Ingen treff</li>}
          </ul>
          {fraAnlop.length > 0 && (
            <>
              <div className="muted fra-anlop">Fra båtanløp</div>
              <div className="chips">
                {fraAnlop.map((b) => <button key={b.id} className="chip" onClick={() => leggTil(b.mmsi!, b.skipsnavn)}>+ {b.skipsnavn}</button>)}
              </div>
            </>
          )}
         </>)}
        </aside>
      </div>
    </>
  );
}
