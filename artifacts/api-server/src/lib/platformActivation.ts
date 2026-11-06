import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { hasDeliveryDetailsSchema, loadDeliveryOptions } from "./deliveryDetails.ts";
import { hasCatalogValidationSchema, catalogDetailsCapabilities } from "./deliveryCatalog.ts";
import { hasRewardFulfillmentSchema, hasRewardFulfillmentEvidence } from "./rewardService.ts";
import { parsePointsPolicy, validIdempotencyKey } from "./pilotPolicy.ts";

// Only operational switches can be changed here. Credentials, identity, AI
// providers and monetary/points policies never come from a browser payload.
export const platformFlags = ["PILOT_CATALOG_ADMIN_ENABLED", "PILOT_CATALOG_PUBLICATION_ENABLED",
  "PILOT_REWARD_ADMIN_ENABLED", "PILOT_REWARD_PUBLICATION_ENABLED", "PILOT_DELIVERY_DETAILS_ENABLED",
  "PILOT_RECEIPT_ENABLED", "PILOT_VERIFICATION_ENABLED", "PILOT_POINTS_ENABLED",
  "PILOT_REWARDS_ENABLED", "PILOT_REWARD_FULFILLMENT_ENABLED"] as const;
type Flag = typeof platformFlags[number];
type Environment = Record<string, string | undefined>;
export type PlatformModule = { key: string; title: string; ready: boolean; enabled: boolean; missing: string[]; flags: Flag[]; href: string };
export type Prerequisites = { catalog: boolean; materials: boolean; rewards: boolean; destinations: boolean; availableRewards: boolean; pointsPolicy: boolean; rewardPolicy: boolean };
export class PlatformActivationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export async function hasPlatformActivationSchema(pool: Pick<Pool, "query">): Promise<boolean> {
  const result = await pool.query<{ ready: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='platform_activation_events' AND obj_description(c.oid,'pg_class')='ecopulse:platform-activation:v1') AS ready`);
  return result.rows[0]?.ready === true;
}

export function mergePlatformEnvironment(base: Environment, stored: unknown): Environment {
  const result = { ...base };
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const flag of platformFlags) {
      if ((stored as Record<string, unknown>)[flag] === true) result[flag] = "true";
    }
  }
  return result;
}

export async function readPlatformEnvironment(pool: Pick<Pool, "query">, base: Environment): Promise<Environment> {
  if (!await hasPlatformActivationSchema(pool)) return { ...base };
  const result = await pool.query("SELECT flags FROM platform_activation_events ORDER BY revision DESC LIMIT 1");
  return mergePlatformEnvironment(base, result.rows[0]?.flags);
}

export function platformModules(p: Prerequisites, env: Environment): PlatformModule[] {
  const module = (key: string, title: string, flags: Flag[], conditions: Array<[boolean, string]>, href: string): PlatformModule => {
    const missing = conditions.filter(([ready]) => !ready).map(([, message]) => message);
    return { key, title, flags, ready: missing.length === 0, enabled: flags.every(flag => env[flag] === "true"), missing, href };
  };
  return [
    module("catalog", "Centros, materiales, ubicaciones y cupos", ["PILOT_CATALOG_ADMIN_ENABLED", "PILOT_CATALOG_PUBLICATION_ENABLED"],
      [[p.catalog, "Esquema de centros y validación no disponible."], [p.materials, "Permisos o catálogo de materiales no disponibles."]], "/admin/centers"),
    module("rewards", "Edición, publicación y cumplimiento de recompensas", ["PILOT_REWARD_ADMIN_ENABLED", "PILOT_REWARD_PUBLICATION_ENABLED", "PILOT_REWARDS_ENABLED", "PILOT_REWARD_FULFILLMENT_ENABLED"],
      [[p.rewards, "Esquema o permisos de recompensas no disponibles."], [p.rewardPolicy, "Falta la política de cumplimiento de recompensas."]], "/admin/rewards"),
    module("deliveries", "Solicitudes de entrega", ["PILOT_DELIVERY_DETAILS_ENABLED"],
      [[p.catalog && p.materials, "Catálogo operativo no disponible."], [p.destinations, "Publica un centro con evidencia real, materiales y horarios futuros con cupo si requiere cita."]], "/admin/centers"),
    module("verification", "Recepción y verificación", ["PILOT_RECEIPT_ENABLED", "PILOT_VERIFICATION_ENABLED"],
      [[p.catalog, "Esquema de entregas y validación no disponible."]], "/admin"),
    module("points", "Acreditación de EcoPuntos", ["PILOT_POINTS_ENABLED"],
      [[p.catalog, "Esquema de entregas no disponible."], [p.pointsPolicy, "Falta una política válida de puntos por kilogramo y límite por entrega."]], "/admin"),
    module("redemptions", "Canjes", ["PILOT_REWARDS_ENABLED", "PILOT_REWARD_FULFILLMENT_ENABLED", "PILOT_POINTS_ENABLED"],
      [[p.catalog && p.rewards, "Esquema operativo no disponible."], [p.pointsPolicy, "Falta una política válida de EcoPuntos."], [p.rewardPolicy, "Falta la política de cumplimiento."], [p.availableRewards, "Publica una recompensa con evidencia de cumplimiento e inventario real disponible."]], "/admin/rewards"),
  ];
}

export async function platformStatus(pool: Pool, env: Environment) {
  const [activationReady, deliverySchema, validationSchema, rewardSchema] = await Promise.all([
    hasPlatformActivationSchema(pool), hasDeliveryDetailsSchema(pool), hasCatalogValidationSchema(pool), hasRewardFulfillmentSchema(pool),
  ]);
  const capabilities = deliverySchema ? await catalogDetailsCapabilities(pool) : null;
  const options = deliverySchema && validationSchema && capabilities?.canReadMaterials
    ? await loadDeliveryOptions(pool, true, true) : null;
  const privilege = rewardSchema ? await pool.query<{ ready: boolean }>(`SELECT has_column_privilege(current_user,'public.rewards','title','INSERT') AND
    (SELECT bool_and(has_column_privilege(current_user,'public.rewards',c,'UPDATE')) FROM unnest(ARRAY['active','inventory_remaining','fulfillment_reference','validated_by','validated_at','updated_at']) AS cols(c)) AS ready`) : null;
  const rewards = rewardSchema ? await pool.query(`SELECT fulfillment_reference,validated_at,validated_by FROM rewards WHERE active=true AND inventory_remaining>0`) : null;
  const modules = platformModules({ catalog: deliverySchema && validationSchema, materials: capabilities?.canEditMaterials === true,
    rewards: rewardSchema && privilege?.rows[0]?.ready === true, destinations: options?.enabled === true,
    availableRewards: rewards?.rows.some(row => hasRewardFulfillmentEvidence(row.fulfillment_reference, row.validated_at, row.validated_by)) === true,
    pointsPolicy: parsePointsPolicy(env.POINTS_PER_KG, env.POINTS_MAX_PER_DELIVERY) !== null,
    rewardPolicy: /^[A-Za-z0-9_:/.-]{10,120}$/.test(env.REWARD_POLICY_REFERENCE ?? ""),
  }, env);
  return { activationReady, modules, pointsPolicy: parsePointsPolicy(env.POINTS_PER_KG, env.POINTS_MAX_PER_DELIVERY) };
}

export async function activatePlatform(pool: Pool, actorId: string, key: unknown, base: Environment) {
  if (!validIdempotencyKey(key)) throw new PlatformActivationError(400, "invalid_idempotency_key");
  if (!await hasPlatformActivationSchema(pool)) throw new PlatformActivationError(503, "platform_activation_schema_required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='20s'");
    const actor = await client.query("SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE", [actorId]);
    if (actor.rows[0]?.role !== "admin") throw new PlatformActivationError(403, "admin_required");
    // All activation requests serialize across administrators and restarts.
    await client.query("SELECT pg_advisory_xact_lock(741926241)");
    const previous = await client.query("SELECT result FROM platform_activation_events WHERE administrator_id=$1 AND idempotency_key=$2", [actorId, key]);
    if (previous.rows[0]) {
      await client.query("COMMIT");
      return { ...previous.rows[0].result, replayed: true };
    }
    // These helpers only use query(); keep every readiness read on this same
    // connection, not a second pool connection while holding the activation lock.
    const queryPool = { query: client.query.bind(client) } as Pool;
    const current = await readPlatformEnvironment(queryPool, base);
    const status = await platformStatus(queryPool, current);
    const flags: Partial<Record<Flag, true>> = {};
    for (const flag of platformFlags) if (current[flag] === "true") flags[flag] = true;
    for (const module of status.modules) if (module.ready) for (const flag of module.flags) flags[flag] = true;
    const modules = status.modules.map(module => ({ ...module, enabled: module.flags.every(flag => flags[flag] === true) }));
    const result = { modules, replayed: false };
    await client.query(`INSERT INTO platform_activation_events(id,administrator_id,idempotency_key,flags,result)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`, [randomUUID(), actorId, key, JSON.stringify(flags), JSON.stringify(result)]);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
