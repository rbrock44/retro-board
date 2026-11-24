import type { AppConfig } from './config';
import type { Db } from './db';
import type { ProviderRegistry } from './auth/providers';
import type { Storage } from './lib/storage';
import type { Hub } from './realtime';

/** Everything a route needs, built once in buildApp and passed to each route module. */
export interface Ctx {
  config: AppConfig;
  db: Db;
  storage: Storage;
  auth: ProviderRegistry;
  hub: Hub;
}
