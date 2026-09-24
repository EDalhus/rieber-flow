import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, useApi, fmtDato, type Bat, type FlateFartoy, type FlateSvar } from '../api';

const kn = (v: number | null) => (v == null ? '–' : `${v.toFixed(1).replace('.', ',')} kn`);
const ferdsel = (f: FlateFartoy) => (f.posisjon?.sog ?? 0) > 0.5;

const skipIkon = (rot: number, valgt: boolean, beveger: boolean) =>
  L.divIcon({
    className: 'ship-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg viewBox="0 0 34 34" style="transform:rotate(${rot}deg)"><path d="M17 3 L27 29 L17 24 L7 29 Z" fill="${valgt ? '#b9f26b' : beveger ? '#145a3a' : '#7a857f'}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  });

/** Kart over Norge (Kartverket) som bare viser fartøyene i brukerens flåte. */
function Kart({ fartoy, valgt, spor, onVelg }: { fartoy: FlateFartoy[]; valgt: string | null; spor: [number, number][]; onVelg: (m: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const kart = useRef<L.Map | null>(null);
  const markorer = useRef(new Map<string, L.Marker>());
  const linje = useRef<L.Polyline | null>(null);
  const passet = useRef(false);

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, attributionControl: true }).setView([64.5, 14], 4);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png', {
      maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/">Kartverket</a> · AIS: Kystverket via Barentswatch',
    }).addTo(m);
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
      const ikon = skipIkon(p.heading ?? p.cog ?? 0, f.mmsi === valgt, ferdsel(f));
      let mk = markorer.current.get(f.mmsi);
      if (!mk) {
        mk = L.marker([p.lat, p.lon], { icon: ikon, riseOnHover: true }).addTo(m);
        mk.bindTooltip(f.navn, { permanent: true, direction: 'right', offset: [12, 0], className: 'ship-label' });
        mk.on('click', () => onVelg(f.mmsi));
        markorer.current.set(f.mmsi, mk);
      } else { mk.setLatLng([p.lat, p.lon]); mk.setIcon(ikon); }
      mk.setZIndexOffset(f.mmsi === valgt ? 1000 : 0);
    }
    for (const [mmsi, mk] of markorer.current) if (!na.has(mmsi)) { mk.remove(); markorer.current.delete(mmsi); }
    if (!passet.current && punkter.length) { m.fitBounds(L.latLngBounds(punkter).pad(0.4), { maxZoom: 7 }); passet.current = true; }
  }, [fartoy, valgt, onVelg]);

  // Spor siste 24 t for valgt fartøy
  useEffect(() => {
    linje.current?.remove();
    linje.current = spor.length > 1 ? L.polyline(spor, { color: '#1f7a4d', weight: 3, dashArray: '6 6', opacity: 0.9 }).addTo(kart.current!) : null;
  }, [spor]);

  useEffect(() => {
    const p = fartoy.find((f) => f.mmsi === valgt)?.posisjon;
    if (p) kart.current?.flyTo([p.lat, p.lon], Math.max(kart.current.getZoom(), 6), { duration: 0.8 });
  }, [valgt]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="kart" />;
}

export function Flate() {
  const { data, reload } = useApi<FlateSvar>('/flate', 30000);
  const { data: bater } = useApi<Bat[]>('/batanlop', 0);
  const [valgt, setValgt] = useState<string | null>(null);
  const [spor, setSpor] = useState<[number, number][]>([]);
  const [q, setQ] = useState('');
  const [treff, setTreff] = useState<{ mmsi: string; navn: string }[]>([]);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!valgt) { setSpor([]); return; }
    api<{ lat: number; lon: number }[]>(`/ais/spor/${valgt}`).then((s) => setSpor(s.map((p) => [p.lat, p.lon]))).catch(() => setSpor([]));
  }, [valgt]);

  useEffect(() => {
    if (q.trim().length < 2) { setTreff([]); return; }
    const t = setTimeout(() => {
      api<{ treff: { mmsi: string; navn: string }[] }>(`/ais/sok?q=${encodeURIComponent(q)}`)
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
  const valgtF = data.fartoy.find((f) => f.mmsi === valgt);

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
      {(data.feil || feil) && <div className="error">{data.feil ?? feil}</div>}

      <div className="flate-grid">
        <div className="kart-wrap"><Kart fartoy={data.fartoy} valgt={valgt} spor={spor} onVelg={setValgt} /></div>

        <aside className="panel flate-panel">
          <h3>Min flåte <span className="muted">· {data.fartoy.length} båter</span></h3>
          <ul className="list flate-liste">
            {data.fartoy.map((f) => (
              <li key={f.mmsi} className={f.mmsi === valgt ? 'valgt' : ''}>
                <button className="flate-rad" onClick={() => setValgt(f.mmsi === valgt ? null : f.mmsi)}>
                  <span className={`dot ${f.posisjon ? (ferdsel(f) ? 'd-ankommet' : 'd-lasting') : ''}`} />
                  <span className="li-main">
                    <b>{f.navn}</b>
                    <small>
                      {f.posisjon
                        ? `${kn(f.posisjon.sog)}${f.posisjon.destinasjon ? ` · → ${f.posisjon.destinasjon}` : ''}`
                        : 'Ingen AIS-posisjon'}
                    </small>
                  </span>
                </button>
                <button className="icon" title="Fjern fra flåten" onClick={() => fjern(f.mmsi)}>✕</button>
              </li>
            ))}
            {data.fartoy.length === 0 && <li className="muted">Flåten er tom – legg til båter under.</li>}
          </ul>

          {valgtF?.posisjon && (
            <div className="detalj">
              <b>{valgtF.navn}</b>
              <span>MMSI {valgtF.mmsi}</span>
              <span>Fart {kn(valgtF.posisjon.sog)} · kurs {valgtF.posisjon.cog != null ? `${Math.round(valgtF.posisjon.cog)}°` : '–'}</span>
              {valgtF.posisjon.destinasjon && <span>Destinasjon {valgtF.posisjon.destinasjon}</span>}
              {valgtF.posisjon.eta && <span>ETA {fmtDato(valgtF.posisjon.eta)}</span>}
              {valgtF.posisjon.msgtime && <span className="muted">Oppdatert {fmtDato(valgtF.posisjon.msgtime)}</span>}
              <span className="muted">Stiplet linje: siste 24 timer</span>
            </div>
          )}

          <h3 className="topp-luft">Legg til båt</h3>
          <input className="wide-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk skipsnavn eller MMSI" />
          <ul className="list treff">
            {treff.map((t) => (
              <li key={t.mmsi}>
                <span className="li-main"><b>{t.navn}</b><small>MMSI {t.mmsi}</small></span>
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
        </aside>
      </div>
    </>
  );
}
