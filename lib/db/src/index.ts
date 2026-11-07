import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  resolveDatabaseUrl,
  resolveGuideDatabaseUrl,
} from "./connectionConfig";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: resolveDatabaseUrl(process.env),
  max: 10,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000,
});
export const db = drizzle(pool, { schema });

let guidePool: pg.Pool | undefined;
export function getGuidePool(): pg.Pool {
  guidePool ??= new Pool({
    connectionString: resolveGuideDatabaseUrl(process.env),
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  return guidePool;
}

export * from "./schema";
