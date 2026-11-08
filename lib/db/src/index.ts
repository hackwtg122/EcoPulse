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
// pg removes broken idle clients itself; an error listener prevents an idle
// server restart or suspend event from becoming an uncaught process exception.
pool.on("error",()=>console.error("Database connection closed; the next request will reconnect."));
export const db = drizzle(pool, { schema });

let guidePool: pg.Pool | undefined;
export function getGuidePool(): pg.Pool {
  if(!guidePool){
    guidePool = new Pool({
    connectionString: resolveGuideDatabaseUrl(process.env),
    max: 3,
    connectionTimeoutMillis: 15000,
    });
    guidePool.on("error",()=>console.error("Guide database connection closed; the next request will reconnect."));
  }
  return guidePool;
}

export * from "./schema";
