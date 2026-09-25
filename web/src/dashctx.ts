import { createContext, useContext } from 'react';
import type { Bat, Dashboard as D, SO } from './api';

/** Data som alle dashboard-widgets deler (hentes én gang og poller). */
export type DashData = { data: D; bater: Bat[]; ko: SO[] };
export const DashCtx = createContext<DashData | null>(null);
export const useDash = () => useContext(DashCtx)!;
