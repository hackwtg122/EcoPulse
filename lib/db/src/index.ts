import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./connectionConfig";

const { Pool } = pg;

export const pool = new Pool({ connectionString: resolveDatabaseUrl(process.env) });
export const db = drizzle(pool, { schema });

export * from "./schema";
