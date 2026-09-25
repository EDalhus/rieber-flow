import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TERMINAL } from './sjovei';

export const skipIkon = (rot: number, valgt: boolean, beveger: boolean, gjest = false) =>
  L.divIcon({
    className: 'ship-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg viewBox="0 0 34 34" style="transform:rotate(${rot}deg)"><path d="M17 3 L27 29 L17 24 L7 29 Z" fill="${gjest ? '#f59e0b' : valgt ? '#b9f26b' : beveger ? '#145a3a' : '#7a857f'}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  });

export const terminalMarker = () =>
  L.marker([TERMINAL.lat, TERMINAL.lon], {
    icon: L.divIcon({ className: 'terminal-ikon', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div>⚓</div>' }), zIndexOffset: 500,
  }).bindTooltip(`Terminal · ${TERMINAL.navn}`, { direction: 'top', offset: [0, -14] });

/** Kartverkets grå bakgrunnskart. */
export const kartverketLag = () =>
  L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/">Kartverket</a> · AIS: Kystverket via Barentswatch',
  });
