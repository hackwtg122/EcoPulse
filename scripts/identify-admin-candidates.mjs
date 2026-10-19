import { fileURLToPath } from "node:url";
import pg from "pg";
process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || url.port !== "5432" || url.pathname !== "/ecopulse_dev" || decodeURIComponent(url.username) !== "ecopulse_app") throw new Error("Expected local ecopulse_dev with ecopulse_app");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(`SELECT u.role, u.created_at,
    (SELECT count(*)::integer FROM scans s WHERE s.user_id = u.clerk_user_id) AS scans,
    (SELECT count(*)::integer FROM deliveries d WHERE d.user_id = u.clerk_user_id) AS deliveries
    FROM users u ORDER BY u.created_at, u.clerk_user_id`);
  console.log(JSON.stringify(result.rows.map((row, index) => ({ account: index + 1, role: row.role, scans: row.scans, deliveries: row.deliveries })), null, 2));
} finally { await pool.end(); }