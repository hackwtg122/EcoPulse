import type { Pool, PoolClient } from "pg";

export class AdminMutationError extends Error {
  readonly status = 403;
  readonly code = "admin_required";
  constructor() { super("admin_required"); }
}

export async function lockCurrentAdministrator(client: PoolClient, actorId: string) {
  const actor = await client.query("SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE", [actorId]);
  if (!actorId || actor.rows[0]?.role !== "admin") throw new AdminMutationError();
}

export async function adminMutation<T>(pool: Pool, actorId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockCurrentAdministrator(client, actorId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
