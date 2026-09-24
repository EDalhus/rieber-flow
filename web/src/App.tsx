import { useEffect, useState } from 'react';
import { api } from './api';
import { Dashboard } from './pages/Dashboard';
import { Anlop, Lasteplan } from './pages/Anlop';
import { SoKo } from './pages/SoKo';
import { Sjafor } from './pages/Sjafor';

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
  ['/', 'Dashboard'],
  ['/anlop', 'Båtanløp'],
  ['/so-ko', 'SO-kø'],
  ['/sjafor', 'Sjåfør-visning'],
] as const;

export function App() {
  const path = useHash();
  const m = path.match(/^\/anlop\/(\d+)/);
  let page;
  if (m) page = <Lasteplan id={+m[1]} />;
  else if (path.startsWith('/anlop')) page = <Anlop />;
  else if (path.startsWith('/so-ko')) page = <SoKo />;
  else if (path.startsWith('/sjafor')) page = <Sjafor />;
  else page = <Dashboard />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">≋</span> Rieber <b>Flow</b>
        </div>
        <nav>
          {NAV.map(([to, label]) => (
            <a key={to} href={`#${to}`} className={(to === '/' ? path === '/' : path.startsWith(to)) ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <button
          className="reset"
          onClick={async () => {
            if (confirm('Nullstill all demodata?')) {
              await api('/admin/reset', 'POST');
              location.reload();
            }
          }}
        >
          Nullstill demo
        </button>
      </aside>
      <main>{page}</main>
    </div>
  );
}
