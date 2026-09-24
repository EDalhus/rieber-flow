import { useEffect, useState } from 'react';
import { api } from './api';
import { Dashboard } from './pages/Dashboard';
import { Anlop, Lasteplan } from './pages/Anlop';
import { SoKo } from './pages/SoKo';
import { Search } from './Search';
import { IconDashboard, IconList, IconShip, Logo } from './icons';

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
] as const;

export function App() {
  const path = useHash();
  const m = path.match(/^\/anlop\/(\d+)/);
  let page;
  if (m) page = <Lasteplan id={+m[1]} />;
  else if (path.startsWith('/anlop')) page = <Anlop />;
  else if (path.startsWith('/so-ko')) page = <SoKo />;
  else page = <Dashboard />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="#/" className="brand"><Logo /> Rieber Flow</a>
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
          <p>Hjullasterne følger lasteplanen live. Endringer her vises i appen innen sekunder.</p>
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
          <div className="user">
            <span className="avatar">TF</span>
            <div><b>Terminalformann</b><small>Kontor · Rieber Flow</small></div>
          </div>
        </header>
        <main>{page}</main>
      </div>
    </div>
  );
}
