const P = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconDashboard = () => (
  <svg {...P}><rect x="3" y="3" width="7" height="9" rx="2" fill="currentColor" stroke="none" /><rect x="14" y="3" width="7" height="5" rx="2" fill="currentColor" stroke="none" /><rect x="14" y="12" width="7" height="9" rx="2" fill="currentColor" stroke="none" /><rect x="3" y="16" width="7" height="5" rx="2" fill="currentColor" stroke="none" /></svg>
);
export const IconShip = () => (
  <svg {...P}><path d="M3 17c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0 3-1.5 4.5 0" /><path d="M5 14l1.5-6h11L19 14" /><path d="M12 8V3M9 5h6" /></svg>
);
export const IconList = () => (
  <svg {...P}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
);
export const IconSearch = () => (
  <svg {...P}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const IconArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M8 7h9v9" /></svg>
);
export const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);
export const Logo = () => (
  <svg width="38" height="38" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="17" stroke="#145a3a" strokeWidth="4" /><path d="M10 22c4-8 7 6 10-1s6-3 10-7" stroke="#145a3a" strokeWidth="4" strokeLinecap="round" /></svg>
);
export const IconMap = () => (
  <svg {...P}><path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4z" /><path d="M9 4v13M15 7v13" /></svg>
);
