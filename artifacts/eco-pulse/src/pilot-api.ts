import { isManualScanCategory, type ManualScanCategory } from "./scan-catalog.ts";

export type PilotScan = {
  id: string;
  category: string;
  source: string;
  createdAt: string;
};

export type PilotDeliveryStatus = "pending" | "scheduled" | "received" | "approved" | "rejected" | "cancelled";
export type PilotDeliveryMaterial = { categoryCode: ManualScanCategory; estimatedGrams: number };
export type PilotDeliveryPoint = {
  id: string;
  code: string;
  name: string;
  address: string;
  municipality: string;
  latitude?: number | null;
  longitude?: number | null;
};
export type PilotDeliverySlot = { id: string; startsAt: string; endsAt: string };
export type PilotDelivery = {
  id: string;
  status: PilotDeliveryStatus;
  requestVersion: 1 | 2;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string | null;
  isOwn?: boolean;
  deliveryPoint: PilotDeliveryPoint | null;
  slot: PilotDeliverySlot | null;
  materials: PilotDeliveryMaterial[];
};

export type PilotDeliveryOptions = {
  mode: "legacy" | "detailed";
  enabled: boolean;
  reason: "feature_disabled" | "migration_pending" | "configuration_pending" | null;
  categories: Array<{ code: ManualScanCategory }>;
  points: Array<PilotDeliveryPoint & {
    timeZone: string;
    appointmentRequired: boolean;
    materials?: ManualScanCategory[];
    slots: Array<PilotDeliverySlot & { remainingCapacity: number }>;
  }>;
};

export type DetailedDeliveryRequest = {
  materials: PilotDeliveryMaterial[];
  deliveryPointId: string;
  slotId: string | null;
};

export type PilotRedemption = {
  id: string;
  rewardId: string;
  cost: number;
  createdAt: string;
};

export type PilotDashboardData = {
  accountId: string;
  role: string;
  balance: number;
  scans: PilotScan[];
  deliveries: PilotDelivery[];
  redemptions: PilotRedemption[];
};

export type PilotDeliveryPage = {
  items: PilotDelivery[];
  nextCursor: string | null;
};

export type PilotProgressBadge = { id: string; title: string; description: string; earned: boolean; earnedAt: string | null };
export type PilotProgressMission = { id: string; title: string; description: string; progress: number; target: number; completed: boolean; xpReward: number };
export type PilotProgress = {
  ecoXp: number;
  level: number;
  levelTitle: string;
  nextLevel: number | null;
  nextLevelXp: number | null;
  xpToNextLevel: number | null;
  classificationCount: number;
  distinctCategories: string[];
  deliveryCount: number;
  approvedDeliveryCount: number;
  streakDays: number;
  badges: PilotProgressBadge[];
  missions: PilotProgressMission[];
  rules: string[];
};
export type VerifierCapabilities = { receiptEnabled: boolean; decisionEnabled: boolean; pointsEnabled: boolean };
export type PilotDeliveryEvent = { fromStatus: PilotDeliveryStatus | null; toStatus: PilotDeliveryStatus; reasonCode: string | null; createdAt: string };
export type VerificationDecision = { decision: "approved"; verifiedGrams: number; receiptCode: string } | { decision: "rejected"; reasonCode: "material_not_received" | "contaminated" | "material_mismatch" | "other" };

export type CoordinationStatus = "pending" | "assigned" | "cancelled";
export type PilotCoordinationEvent = {
  fromStatus: CoordinationStatus | null;
  toStatus: CoordinationStatus;
  reasonCode: string | null;
  createdAt: string;
};
export type PilotCoordinationRequest = {
  requestedPointId: string | null;
  requestedPointName: string | null;
  preferredAt: string | null;
  id: string;
  status: CoordinationStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  materials: PilotDeliveryMaterial[];
  events: PilotCoordinationEvent[];
  deliveryId: string | null;
  deliveryStatus: PilotDeliveryStatus | null;
  assignedPoint: PilotDeliveryPoint | null;
  accountId?: string;
};
export type CoordinationRequestInput = { materials: PilotDeliveryMaterial[]; note: string | null; requestedPointId?: string | null; preferredAt?: string | null };
export type CoordinationAssignmentInput = { deliveryPointId: string; slotId: string | null };


export class PilotApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Human-readable wait hint shared by EcoScan and EcoGuía. The server sends the
// remaining seconds for a quota window or an advertised provider rate limit.
export function retryWaitSuffix(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 90) return ` Reintenta en ${Math.ceil(seconds)} s.`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return ` Reintenta en ~${minutes} min.`;
  return " Reintenta después de las 00:00 UTC.";
}

type FetchImplementation = typeof fetch;

export function isCurrentPilotResponse(
  activeRequestId: number,
  responseRequestId: number,
  activeAccountId: string,
  responseAccountId: string,
) {
  return activeRequestId === responseRequestId && activeAccountId === responseAccountId;
}

async function responseError(response: Response): Promise<PilotApiError> {
  try {
    const body: unknown = await response.json();
    const code = typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `pilot_api_${response.status}`;
    return new PilotApiError(response.status, code);
  } catch {
    return new PilotApiError(response.status, `pilot_api_${response.status}`);
  }
}

async function requestJson(
  apiUrl: string,
  endpoint: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation,
) {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PilotApiError(502, `invalid_${name}`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
    throw new PilotApiError(502, `invalid_${name}_response`);
  }
  return value as Array<Record<string, unknown>>;
}

function parseStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((row) => typeof row !== "string")) {
    throw new PilotApiError(502, `invalid_${name}_response`);
  }
  return value as string[];
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new PilotApiError(502, `invalid_${name}`);
  return value;
}

function parseScan(row: Record<string, unknown>): PilotScan {
  const category = requireString(row.category, "scan_category");
  if (!isManualScanCategory(category)) throw new PilotApiError(502, "invalid_scan_category");
  const source = requireString(row.source, "scan_source");
  // Only classifications created and confirmed by the user are real activity.
  if (source !== "manual") throw new PilotApiError(502, "invalid_scan_source");
  return {
    id: requireString(row.id, "scan_id"),
    category,
    source,
    createdAt: requireString(row.createdAt, "scan_created_at"),
  };
}

function parseCoordinate(value: unknown, name: string, limit: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new PilotApiError(502, `invalid_${name}`);
  }
  return value;
}

function parseDeliveryPoint(value: unknown): PilotDeliveryPoint | null {
  if (value === null || value === undefined) return null;
  const row = requireObject(value, "delivery_point");
  const latitude = parseCoordinate(row.latitude, "delivery_point_latitude", 90);
  const longitude = parseCoordinate(row.longitude, "delivery_point_longitude", 180);
  return {
    id: requireString(row.id, "delivery_point_id"),
    code: requireString(row.code, "delivery_point_code"),
    name: requireString(row.name, "delivery_point_name"),
    address: requireString(row.address, "delivery_point_address"),
    municipality: requireString(row.municipality, "delivery_point_municipality"),
    ...(latitude !== null && longitude !== null ? { latitude, longitude } : {}),
  };
}

function parseDeliverySlot(value: unknown): PilotDeliverySlot | null {
  if (value === null || value === undefined) return null;
  const row = requireObject(value, "delivery_slot");
  return {
    id: requireString(row.id, "delivery_slot_id"),
    startsAt: requireString(row.startsAt, "delivery_slot_start"),
    endsAt: requireString(row.endsAt, "delivery_slot_end"),
  };
}

function parseMaterials(value: unknown): PilotDeliveryMaterial[] {
  if (value === undefined) return [];
  return requireArray(value, "delivery_materials").map((row) => {
    const categoryCode = requireString(row.categoryCode, "material_category");
    if (!isManualScanCategory(categoryCode) || !Number.isSafeInteger(row.estimatedGrams) || (row.estimatedGrams as number) < 1) {
      throw new PilotApiError(502, "invalid_delivery_material");
    }
    return { categoryCode, estimatedGrams: row.estimatedGrams as number };
  });
}

function parseDelivery(row: Record<string, unknown>): PilotDelivery {
  const status = requireString(row.status, "delivery_status");
  if (!["pending", "scheduled", "received", "approved", "rejected", "cancelled"].includes(status)) {
    throw new PilotApiError(502, "invalid_delivery_status");
  }
  const requestVersion = row.requestVersion === undefined ? 1 : row.requestVersion;
  if (requestVersion !== 1 && requestVersion !== 2) throw new PilotApiError(502, "invalid_delivery_version");
  const createdAt = requireString(row.createdAt, "delivery_created_at");
  return {
    id: requireString(row.id, "delivery_id"),
    status: status as PilotDeliveryStatus,
    requestVersion,
    createdAt,
    updatedAt: row.updatedAt === undefined ? createdAt : requireString(row.updatedAt, "delivery_updated_at"),
    ...(row.acceptedAt == null ? {} : { acceptedAt: requireString(row.acceptedAt, "delivery_accepted_at") }),
    ...(typeof row.isOwn === "boolean" ? { isOwn: row.isOwn } : {}),
    deliveryPoint: parseDeliveryPoint(row.deliveryPoint),
    slot: parseDeliverySlot(row.slot),
    materials: parseMaterials(row.materials),
  };
}

function parseCoordinationEvent(row: Record<string, unknown>): PilotCoordinationEvent {
  const toStatus = requireString(row.toStatus, "coordination_event_status") as CoordinationStatus;
  if (!["pending", "assigned", "cancelled"].includes(toStatus)) throw new PilotApiError(502, "invalid_coordination_event_status");
  const fromStatus = row.fromStatus === null || row.fromStatus === undefined
    ? null
    : requireString(row.fromStatus, "coordination_event_from_status") as CoordinationStatus;
  if (fromStatus !== null && !["pending", "assigned", "cancelled"].includes(fromStatus)) {
    throw new PilotApiError(502, "invalid_coordination_event_from_status");
  }
  return {
    fromStatus,
    toStatus,
    reasonCode: row.reasonCode === null || row.reasonCode === undefined ? null : requireString(row.reasonCode, "coordination_event_reason"),
    createdAt: requireString(row.createdAt, "coordination_event_created_at"),
  };
}

function parseCoordinationRequest(row: Record<string, unknown>): PilotCoordinationRequest {
  const status = requireString(row.status, "coordination_status") as CoordinationStatus;
  if (!["pending", "assigned", "cancelled"].includes(status)) throw new PilotApiError(502, "invalid_coordination_status");
  const deliveryStatus = row.deliveryStatus === null || row.deliveryStatus === undefined
    ? null
    : requireString(row.deliveryStatus, "coordination_delivery_status") as PilotDeliveryStatus;
  if (deliveryStatus !== null && !["pending", "scheduled", "received", "approved", "rejected", "cancelled"].includes(deliveryStatus)) {
    throw new PilotApiError(502, "invalid_coordination_delivery_status");
  }
  return {
    requestedPointId: typeof row.requestedPointId === "string" ? row.requestedPointId : null,
    requestedPointName: typeof row.requestedPointName === "string" ? row.requestedPointName : null,
    preferredAt: typeof row.preferredAt === "string" ? row.preferredAt : null,
    id: requireString(row.id, "coordination_id"),
    status,
    note: row.note === null || row.note === undefined ? null : requireString(row.note, "coordination_note"),
    createdAt: requireString(row.createdAt, "coordination_created_at"),
    updatedAt: requireString(row.updatedAt, "coordination_updated_at"),
    materials: parseMaterials(row.materials),
    events: (Array.isArray(row.events) ? row.events : []).map((event) => parseCoordinationEvent(requireObject(event, "coordination_event"))),
    deliveryId: row.deliveryId === null || row.deliveryId === undefined ? null : requireString(row.deliveryId, "coordination_delivery_id"),
    deliveryStatus,
    assignedPoint: parseDeliveryPoint(row.assignedPoint),
    ...(row.accountId === undefined ? {} : { accountId: requireString(row.accountId, "coordination_account_id") }),
  };
}

export async function createPilotScan(
  apiUrl: string,
  token: string,
  category: ManualScanCategory,
  idempotencyKey: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotScan> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/scans`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ category }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  return parseScan(requireObject(await response.json(), "scan_response"));
}

async function postDelivery(
  apiUrl: string,
  token: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation,
): Promise<{ delivery: PilotDelivery; replayed: boolean }> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/deliveries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  return {
    delivery: parseDelivery(requireObject(await response.json(), "delivery_response")),
    replayed: response.headers.get("Idempotency-Replayed") === "true",
  };
}

export function createPilotDelivery(
  apiUrl: string,
  token: string,
  idempotencyKey: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
) {
  return postDelivery(apiUrl, token, idempotencyKey, {}, signal, fetchImplementation);
}

export function createDetailedPilotDelivery(
  apiUrl: string,
  token: string,
  idempotencyKey: string,
  payload: DetailedDeliveryRequest,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
) {
  return postDelivery(apiUrl, token, idempotencyKey, payload, signal, fetchImplementation);
}

export async function createPilotCoordinationRequest(
  apiUrl: string,
  token: string,
  idempotencyKey: string,
  payload: CoordinationRequestInput,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ request: PilotCoordinationRequest; replayed: boolean }> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/coordination-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  return {
    request: parseCoordinationRequest(requireObject(await response.json(), "coordination_response")),
    replayed: response.headers.get("Idempotency-Replayed") === "true",
  };
}

export async function loadCoordinationRequests(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ items: PilotCoordinationRequest[]; schemaReady: boolean }> {
  const body = requireObject(
    await requestJson(apiUrl, "coordination-requests", token, signal, fetchImplementation),
    "coordination_response",
  );
  if (typeof body.schemaReady !== "boolean") throw new PilotApiError(502, "invalid_coordination_schema_state");
  return {
    items: requireArray(body.items, "coordination_requests").map(parseCoordinationRequest),
    schemaReady: body.schemaReady,
  };
}

export async function loadAdminCoordinationRequests(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ items: PilotCoordinationRequest[]; schemaReady: boolean }> {
  const body = requireObject(
    await requestJson(apiUrl, "admin/coordination-requests", token, signal, fetchImplementation),
    "coordination_response",
  );
  if (typeof body.schemaReady !== "boolean") throw new PilotApiError(502, "invalid_coordination_schema_state");
  return {
    items: requireArray(body.items, "coordination_requests").map(parseCoordinationRequest),
    schemaReady: body.schemaReady,
  };
}

export async function cancelPilotCoordinationRequest(
  apiUrl: string,
  token: string,
  requestId: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ requestId: string; status: "cancelled"; replayed: boolean }> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/coordination-requests/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const body = requireObject(await response.json(), "coordination_cancel_response");
  if (body.requestId !== requestId || body.status !== "cancelled" || typeof body.replayed !== "boolean") {
    throw new PilotApiError(502, "invalid_coordination_cancel_response");
  }
  return { requestId, status: "cancelled", replayed: body.replayed };
}

export async function assignPilotCoordinationRequest(
  apiUrl: string,
  token: string,
  requestId: string,
  payload: CoordinationAssignmentInput,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ request: PilotCoordinationRequest; deliveryId: string; replayed: boolean }> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/admin/coordination-requests/${encodeURIComponent(requestId)}/assign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const body = requireObject(await response.json(), "coordination_assignment_response");
  return {
    request: parseCoordinationRequest(requireObject(body.request, "coordination_response")),
    deliveryId: requireString(body.deliveryId, "coordination_delivery_id"),
    replayed: body.replayed === true,
  };
}

export async function loadPilotDeliveryOptions(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotDeliveryOptions> {
  const row = requireObject(
    await requestJson(apiUrl, "delivery-options", token, signal, fetchImplementation),
    "delivery_options_response",
  );
  if ((row.mode !== "legacy" && row.mode !== "detailed") || typeof row.enabled !== "boolean") {
    throw new PilotApiError(502, "invalid_delivery_options");
  }
  const validReasons = [null, "feature_disabled", "migration_pending", "configuration_pending"];
  if (!validReasons.includes(row.reason as never)) throw new PilotApiError(502, "invalid_delivery_options_reason");
  const categories = requireArray(row.categories, "delivery_categories").map((category) => {
    const code = requireString(category.code, "delivery_category");
    if (!isManualScanCategory(code)) throw new PilotApiError(502, "invalid_delivery_category");
    return { code };
  });
  const points = requireArray(row.points, "delivery_points").map((point) => {
    const parsedPoint = parseDeliveryPoint(point);
    if (!parsedPoint || typeof point.appointmentRequired !== "boolean") {
      throw new PilotApiError(502, "invalid_delivery_point");
    }
    return {
      ...parsedPoint,
      timeZone: requireString(point.timeZone, "delivery_point_timezone"),
       appointmentRequired: point.appointmentRequired,
       ...(point.materials === undefined ? {} : { materials: parseStringArray(point.materials, "delivery_point_materials").map(material => {
         if (!isManualScanCategory(material)) throw new PilotApiError(502, "invalid_delivery_point_material");
         return material;
       }) }),
      slots: requireArray(point.slots, "delivery_slots").map((slot) => {
        const parsedSlot = parseDeliverySlot(slot);
        if (!parsedSlot || !Number.isSafeInteger(slot.remainingCapacity) || (slot.remainingCapacity as number) < 1) {
          throw new PilotApiError(502, "invalid_delivery_slot");
        }
        return { ...parsedSlot, remainingCapacity: slot.remainingCapacity as number };
      }),
    };
  });
  return {
    mode: row.mode,
    enabled: row.enabled,
    reason: row.reason as PilotDeliveryOptions["reason"],
    categories,
    points,
  };
}

export async function loadPilotPublicPoints(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotDeliveryOptions["points"]> {
  const body = requireObject(
    await requestJson(apiUrl, "delivery-points", token, signal, fetchImplementation),
    "delivery_points_response",
  );
  return requireArray(body.points, "delivery_points").map((point) => {
    const parsed = parseDeliveryPoint(point);
    if (!parsed || typeof point.appointmentRequired !== "boolean") {
      throw new PilotApiError(502, "invalid_delivery_point");
    }
    return {
      ...parsed,
      timeZone: requireString(point.timeZone, "delivery_point_timezone"),
      appointmentRequired: point.appointmentRequired,
      ...(point.materials === undefined ? {} : { materials: parseStringArray(point.materials, "delivery_point_materials").map(material => {
        if (!isManualScanCategory(material)) throw new PilotApiError(502, "invalid_delivery_point_material");
        return material;
      }) }),
      slots: requireArray(point.slots, "delivery_slots").map((slot) => {
        const parsedSlot = parseDeliverySlot(slot);
        if (!parsedSlot || !Number.isSafeInteger(slot.remainingCapacity) || (slot.remainingCapacity as number) < 1) {
          throw new PilotApiError(502, "invalid_delivery_slot");
        }
        return { ...parsedSlot, remainingCapacity: slot.remainingCapacity as number };
      }),
    };
  });
}
// Evaluation-only test points served by the real API. Clearly separated from
// published centers: they are not establishments and never accept deliveries.
export type EvaluationPoint = {
  id: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  materials: string[];
  hours: string;
  capacity: number;
  responsible: string;
  isTest: true;
};

export async function loadEvaluationPoints(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<EvaluationPoint[]> {
  const body = requireObject(await requestJson(apiUrl, "evaluation-points", token, signal, fetchImplementation), "evaluation_points_response");
  return requireArray(body.points, "evaluation_points").map((row) => {
    const point = requireObject(row, "evaluation_point");
    const materials = parseStringArray(point.materials, "evaluation_point_materials");
    if (typeof point.lat !== "number" || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
        typeof point.lng !== "number" || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180 ||
        !Number.isSafeInteger(point.capacity) || (point.capacity as number) < 1 ||
        point.isTest !== true) {
      throw new PilotApiError(502, "invalid_evaluation_point");
    }
    return {
      id: requireString(point.id, "evaluation_point_id"),
      name: requireString(point.name, "evaluation_point_name"),
      zone: requireString(point.zone, "evaluation_point_zone"),
      lat: point.lat, lng: point.lng,
      materials,
      hours: requireString(point.hours, "evaluation_point_hours"),
      capacity: point.capacity as number,
      responsible: requireString(point.responsible, "evaluation_point_responsible"),
      isTest: true as const,
    };
  });
}

export async function loadPilotProgress(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotProgress> {
  const body = requireObject(await requestJson(apiUrl, "progress", token, signal, fetchImplementation), "progress_response");
  const number = (value: unknown, name: string) => { if (!Number.isSafeInteger(value)) throw new PilotApiError(502, `invalid_${name}`); return value as number; };
  return {
    ecoXp: number(body.ecoXp, "eco_xp"),
    level: number(body.level, "level"),
    levelTitle: requireString(body.levelTitle, "level_title"),
    nextLevel: body.nextLevel === null ? null : number(body.nextLevel, "next_level"),
    nextLevelXp: body.nextLevelXp === null ? null : number(body.nextLevelXp, "next_level_xp"),
    xpToNextLevel: body.xpToNextLevel === null ? null : number(body.xpToNextLevel, "xp_to_next_level"),
    classificationCount: number(body.classificationCount, "classification_count"),
    distinctCategories: parseStringArray(body.distinctCategories, "distinct_categories"),
    deliveryCount: number(body.deliveryCount, "delivery_count"),
    approvedDeliveryCount: number(body.approvedDeliveryCount, "approved_delivery_count"),
    streakDays: number(body.streakDays, "streak_days"),
    badges: requireArray(body.badges, "badges").map((row) => ({
      id: requireString(row.id, "badge_id"),
      title: requireString(row.title, "badge_title"),
      description: requireString(row.description, "badge_description"),
      earned: row.earned === true,
      earnedAt: row.earnedAt === null ? null : requireString(row.earnedAt, "badge_earned_at"),
    })),
    missions: requireArray(body.missions, "missions").map((row) => ({
      id: requireString(row.id, "mission_id"),
      title: requireString(row.title, "mission_title"),
      description: requireString(row.description, "mission_description"),
      progress: number(row.progress, "mission_progress"),
      target: number(row.target, "mission_target"),
      completed: row.completed === true,
      xpReward: number(row.xpReward, "mission_xp_reward"),
    })),
    rules: parseStringArray(body.rules, "rules"),
  };
}

export async function loadVerifierDeliveryQueue(
  apiUrl: string,
  token: string,
  cursor: string | null,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotDeliveryPage> {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const body = requireObject(await requestJson(apiUrl, `verifier/deliveries?${query.toString()}`, token, signal, fetchImplementation), "delivery_queue_response");
  const nextCursor = body.nextCursor;
  if (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor || nextCursor.length > 256)) {
    throw new PilotApiError(502, "invalid_delivery_cursor");
  }
  return { items: requireArray(body.items, "delivery_queue").map(parseDelivery), nextCursor: nextCursor as string | null };
}

export async function loadVerifierCapabilities(
  apiUrl: string, token: string, signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<VerifierCapabilities> {
  const body = requireObject(await requestJson(apiUrl, "verifier/capabilities", token, signal, fetchImplementation), "verifier_capabilities");
  if (typeof body.receiptEnabled !== "boolean" || typeof body.decisionEnabled !== "boolean" || typeof body.pointsEnabled !== "boolean") {
    throw new PilotApiError(502, "invalid_verifier_capabilities");
  }
  return { receiptEnabled: body.receiptEnabled, decisionEnabled: body.decisionEnabled, pointsEnabled: body.pointsEnabled };
}

export async function loadPilotDeliveryEvents(
  apiUrl: string, token: string, deliveryId: string, signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotDeliveryEvent[]> {
  const body = requireObject(await requestJson(apiUrl, `deliveries/${encodeURIComponent(deliveryId)}/events`, token, signal, fetchImplementation), "delivery_events");
  return requireArray(body.items, "delivery_events").map((row) => {
    const toStatus = requireString(row.toStatus, "event_status") as PilotDeliveryStatus;
    if (!["pending", "scheduled", "received", "approved", "rejected", "cancelled"].includes(toStatus)) throw new PilotApiError(502, "invalid_event_status");
    const fromStatus = row.fromStatus === null ? null : requireString(row.fromStatus, "event_from_status") as PilotDeliveryStatus;
    if (fromStatus !== null && !["pending", "scheduled", "received", "approved", "rejected", "cancelled"].includes(fromStatus)) throw new PilotApiError(502, "invalid_event_from_status");
    const reasonCode = row.reasonCode === null ? null : requireString(row.reasonCode, "event_reason");
    return { fromStatus, toStatus, reasonCode, createdAt: requireString(row.createdAt, "event_created_at") };
  });
}

async function postVerifierAction(
  apiUrl: string, token: string, deliveryId: string, action: "receive" | "verify" | "schedule" | "cancel", payload: object,
  signal: AbortSignal, fetchImplementation: FetchImplementation,
) {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/deliveries/${encodeURIComponent(deliveryId)}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), cache: "no-store", signal,
  });
  if (!response.ok) throw await responseError(response);
  return requireObject(await response.json(), "verifier_action");
}

export async function acceptPilotDelivery(apiUrl: string, token: string, deliveryId: string, signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch): Promise<{ deliveryId: string; acceptedAt: string; replayed: boolean }> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/admin/deliveries/${encodeURIComponent(deliveryId)}/accept`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}), cache: "no-store", signal,
  });
  if (!response.ok) throw await responseError(response);
  const data = requireObject(await response.json(), "accept_delivery_response");
  if (data.deliveryId !== deliveryId || typeof data.replayed !== "boolean") throw new PilotApiError(502, "invalid_delivery_acceptance_response");
  return { deliveryId, acceptedAt: requireString(data.acceptedAt, "delivery_accepted_at"), replayed: data.replayed };
}

export function receivePilotDelivery(
  apiUrl: string, token: string, deliveryId: string, signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
) {
  return postVerifierAction(apiUrl, token, deliveryId, "receive", {}, signal, fetchImplementation);
}

export async function updateOwnPilotDelivery(
  apiUrl: string, token: string, deliveryId: string, action: "schedule" | "cancel", signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
) {
  const result = await postVerifierAction(apiUrl, token, deliveryId, action, {}, signal, fetchImplementation);
  const expected = action === "schedule" ? "scheduled" : "cancelled";
  if (result.deliveryId !== deliveryId || result.status !== expected || typeof result.replayed !== "boolean") {
    throw new PilotApiError(502, "invalid_delivery_action_response");
  }
  return { deliveryId, status: expected, replayed: result.replayed };
}

export function verifyPilotDelivery(
  apiUrl: string, token: string, deliveryId: string, decision: VerificationDecision, signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
) {
  return postVerifierAction(apiUrl, token, deliveryId, "verify", decision, signal, fetchImplementation);
}

export async function loadPilotDashboardData(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PilotDashboardData> {
  const [me, balanceResponse, scansResponse, deliveriesResponse, redemptionsResponse] = await Promise.all([
    requestJson(apiUrl, "me", token, signal, fetchImplementation),
    requestJson(apiUrl, "balance", token, signal, fetchImplementation),
    requestJson(apiUrl, "scans", token, signal, fetchImplementation),
    requestJson(apiUrl, "deliveries", token, signal, fetchImplementation),
    requestJson(apiUrl, "redemptions", token, signal, fetchImplementation),
  ]);
  const balance = (balanceResponse as { balance?: unknown })?.balance;
  if (!Number.isSafeInteger(balance)) throw new PilotApiError(502, "invalid_balance_response");
  // Ignore legacy demo rows instead of failing the whole dashboard or showing
  // simulated activity as real. The server also filters these rows.
  const scans = requireArray(scansResponse, "scans")
    .filter((row) => row.source !== "demo")
    .map(parseScan);
  const deliveries = requireArray(deliveriesResponse, "deliveries").map(parseDelivery);
  const redemptions = requireArray(redemptionsResponse, "redemptions").map((row) => {
    if (!Number.isSafeInteger(row.cost) || (row.cost as number) < 1) throw new PilotApiError(502, "invalid_redemption_cost");
    return {
      id: requireString(row.id, "redemption_id"),
      rewardId: requireString(row.rewardId, "redemption_reward_id"),
      cost: row.cost as number,
      createdAt: requireString(row.createdAt, "redemption_created_at"),
    };
  });
  return {
    accountId: requireString((me as { id?: unknown })?.id, "account_id"),
    role: requireString((me as { role?: unknown })?.role, "account_role"),
    balance: balance as number,
    scans,
    deliveries,
    redemptions,
  };
}

export type AdminUserRole = "participant" | "verifier" | "admin";
export type AdminUser = { clerkUserId: string; role: AdminUserRole; createdAt: string };
export type AdminUsersPayload = { users: AdminUser[]; adminCount: number; nextCursor: string | null };

function parseAdminUser(row: Record<string, unknown>): AdminUser {
  const role = requireString(row.role, "admin_user_role");
  if (role !== "participant" && role !== "verifier" && role !== "admin") throw new PilotApiError(502, "invalid_admin_user_role");
  return {
    clerkUserId: requireString(row.clerkUserId, "admin_user_id"),
    role,
    createdAt: requireString(row.createdAt, "admin_user_created_at"),
  };
}

export async function loadAdminUsers(
  apiUrl: string,
  token: string,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
  after: string | null = null,
): Promise<AdminUsersPayload> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/admin/users${after ? `?after=${encodeURIComponent(after)}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const body = requireObject(await response.json(), "admin_users");
  const users = requireArray(body.users, "admin_users").map(parseAdminUser);
  if (!Number.isSafeInteger(body.adminCount) || (body.adminCount as number) < 0) throw new PilotApiError(502, "invalid_admin_count");
  const nextCursor = body.nextCursor ?? null;
  if (nextCursor !== null && (typeof nextCursor !== "string" || !/^user_[A-Za-z0-9]{3,64}$/.test(nextCursor))) {
    throw new PilotApiError(502, "invalid_admin_users_cursor");
  }
  return { users, adminCount: body.adminCount as number, nextCursor };
}

export async function updateAdminUserRole(
  apiUrl: string,
  token: string,
  clerkUserId: string,
  role: AdminUserRole,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ changed: boolean; auditRecorded: boolean }> {
  const response = await fetchImplementation(`${apiUrl}/api/pilot/admin/users/${encodeURIComponent(clerkUserId)}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const body = requireObject(await response.json(), "admin_role_update");
  if (body.ok !== true || typeof body.changed !== "boolean" || typeof body.auditRecorded !== "boolean" || (body.changed && !body.auditRecorded)) {
    throw new PilotApiError(502, "invalid_admin_role_update");
  }
  return { changed: body.changed === true, auditRecorded: body.auditRecorded === true };
}
