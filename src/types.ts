import type { AisEnv } from './ais';

export type Env = { Bindings: { DB: D1Database; ASSETS: Fetcher } & AisEnv };
