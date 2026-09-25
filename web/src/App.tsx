import { useEffect, useState } from 'react';
import { api, useApi, type Meg } from './api';
import { Dashboard } from './pages/Dashboard';
import { Anlop, Lasteplan } from './pages/Anlop';
import { SoKo } from './pages/SoKo';
import { Flate } from './pages/Flate';
import { Kaibok } from './pages/Kaibok';
import { Kalender } from './pages/Kalender';
import { Search } from './Search';
import { IconDashboard, IconBook, IconCalendar, IconList, IconMap, IconShip, Logo } from './icons';

function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || '/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

const NAV = [
  ['/', 'Dashboard', <IconDashboard />],
  ['/anlop', 'Båtanløp', <IconShip />],
  ['/so-ko', 'SO-kø', <IconList />],
  ['/flate', 'Flåte & kart', <IconMap />],
  ['/kaibok', 'Kaibok', <IconBook />],
  ['/kalender', 'Kalender', <IconCalendar />],
] as const;

function Bruker() {
  const { data } = useApi<Meg>('/meg', 0);
  if (!data) return <div className="user" />;
  const b = data.bruker;
  const ini = b.navn.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="user">
      <span className="avatar">{ini}</span>
      <div>
        {data.demo ? (
          <select
            className="user-sel"
            value={b.epost}
            title="Demo: bytt bruker (ekte innlogging via Cloudflare Access)"
            onChange={(e) => { try { localStorage.setItem('flow-user', e.target.value); } catch {} location.reload(); }}
          >
            {data.brukere.map((u) => <option key={u.id} value={u.epost}>{u.navn}</option>)}
          </select>
        ) : <b>{b.navn}</b>}
        <small>{b.rolle} · Rieber Flow</small>
      </div>
    </div>
  );
}

export function App() {
  const path = useHash();
  const m = path.match(/^\/anlop\/(\d+)/);
  let page;
  if (m) page = <Lasteplan id={+m[1]} />;
  else if (path.startsWith('/anlop')) page = <Anlop />;
  else if (path.startsWith('/so-ko')) page = <SoKo />;
  else if (path.startsWith('/flate')) page = <Flate />;
  else if (path.startsWith('/kaibok')) page = <Kaibok />;
  else if (path.startsWith('/kalender')) page = <Kalender />;
  else page = <Dashboard />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="#/" className="brand"><Logo /> Flow</a>
        <div className="nav-label">MENY</div>
        <nav>
          {NAV.map(([to, label, icon]) => (
            <a key={to} href={`#${to}`} className={(to === '/' ? path === '/' : path.startsWith(to)) ? 'active' : ''}>
              {icon} {label}
            </a>
          ))}
        </nav>
        <div className="promo">
          <b>Sjåførappen</b>
          <p>Hold deg oppdatert på lasteplanen</p>
          <button
            onClick={async () => {
              if (confirm('Nullstill all demodata?')) {
                await api('/admin/reset', 'POST');
                location.reload();
              }
            }}
          >
            Nullstill demo
          </button>
        </div>
      </aside>
      <div className="col">
        <header className="topbar">
          <Search />
          <Bruker />
        </header>
        <main>{page}</main>
      </div>
    </div>
  );
}
