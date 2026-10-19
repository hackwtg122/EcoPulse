import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";
import { CalendarClock, Clock3, MapPin, PackageCheck, ShieldCheck } from "lucide-react";
import {
  createDetailedPilotDelivery,
  createPilotDelivery,
  loadPilotDeliveryOptions,
  loadVerifierDeliveryQueue,
  loadVerifierCapabilities,
  loadPilotDeliveryEvents,
  receivePilotDelivery,
  verifyPilotDelivery,
  PilotApiError,
  type PilotDeliveryEvent,
  type VerifierCapabilities,
  type DetailedDeliveryRequest,
  type PilotDelivery,
  type PilotDeliveryOptions,
} from "./pilot-api";
import type { ManualScanCategory } from "./scan-catalog";

const pilotApiUrl = import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001";
const pendingOperationStorageKey = (userId: string | null | undefined) => `ecopulse:pending-delivery-operation-v2:${userId ?? "signed-out"}`;
const idempotencyPattern = /^[A-Za-z0-9_-]{8,128}$/;

const deliveryLabels: Record<PilotDelivery["status"], string> = {
  pending: "Pendiente",
  scheduled: "Programada",
  received: "Recibida, por verificar",
  approved: "Verificada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};
const materialLabels: Record<ManualScanCategory, string> = {
  paper: "Papel y cartón",
  plastic: "Plástico",
  glass: "Vidrio",
  metal: "Metal",
  organic: "Orgánico",
  other: "Otro material",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusTone(status: PilotDelivery["status"]) {
  if (status === "approved") return "bg-emerald-100 text-emerald-900";
  if (status === "rejected" || status === "cancelled") return "bg-red-100 text-red-900";
  if (status === "scheduled" || status === "received") return "bg-blue-100 text-blue-900";
  return "bg-amber-100 text-amber-900";
}

function DeliveryHistory({ deliveries }: { deliveries: PilotDelivery[] }) {
  return <div className="mt-5 space-y-3" data-testid="delivery-history">
    {deliveries.slice(0, 20).map((delivery) => <article key={delivery.id} className="rounded-2xl bg-[hsl(var(--muted)/.65)] px-4 py-4" data-testid={`row-delivery-${delivery.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{deliveryLabels[delivery.status]}</p>
            <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">
              {delivery.requestVersion === 1 ? "Solicitud anterior · V1" : "Solicitud detallada · V2"}
            </span>
          </div>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{formatDate(delivery.createdAt)}</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${statusTone(delivery.status)}`}>{deliveryLabels[delivery.status]}</span>
      </div>
      {delivery.requestVersion === 2 && <div className="mt-4 grid gap-3 border-t border-[hsl(var(--border))] pt-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-semibold text-[hsl(var(--foreground))]">Materiales estimados</p>
          <ul className="mt-1 space-y-1 text-[hsl(var(--muted-foreground))]">
            {delivery.materials.map((material) => <li key={material.categoryCode}>{materialLabels[material.categoryCode]} · {(material.estimatedGrams / 1000).toLocaleString("es-CO", { maximumFractionDigits: 3 })} kg estimados</li>)}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-[hsl(var(--foreground))]">Punto solicitado</p>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">{delivery.deliveryPoint ? `${delivery.deliveryPoint.name}, ${delivery.deliveryPoint.municipality}` : "Sin punto disponible"}</p>
          {delivery.slot && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Horario: {formatDate(delivery.slot.startsAt)}</p>}
        </div>
      </div>}
    </article>)}
    {!deliveries.length && <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]" data-testid="empty-deliveries">No hay solicitudes de entrega registradas.</p>}
  </div>;
}

const rejectionLabels = {
  material_not_received: "Material no recibido",
  contaminated: "Material contaminado",
  material_mismatch: "Material diferente al declarado",
  other: "Otro motivo documentado",
} as const;
type RejectionReason = keyof typeof rejectionLabels;

export function VerifierQueue({ role, onRefresh }: { role: string; onRefresh: () => void }) {
  const authorized = role === "verifier" || role === "admin";
  const { getToken } = useAuth();
  const [items, setItems] = useState<PilotDelivery[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<VerifierCapabilities | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<PilotDeliveryEvent[]>([]);
  const [auditStatus, setAuditStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [action, setAction] = useState<"receive" | "approve" | "reject" | null>(null);
  const [weightGrams, setWeightGrams] = useState("");
  const [receiptCode, setReceiptCode] = useState("");
  const [reasonCode, setReasonCode] = useState<RejectionReason>("material_not_received");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const auditSequence = useRef(0);

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    if (!authorized || inFlight.current) return;
    inFlight.current = true;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const [page, nextCapabilities] = await Promise.all([
        loadVerifierDeliveryQueue(pilotApiUrl, token, cursor, requestController.signal),
        loadVerifierCapabilities(pilotApiUrl, token, requestController.signal),
      ]);
      if (requestController.signal.aborted) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
      setCapabilities(nextCapabilities);
      setStatus("ready");
    } catch {
      if (!requestController.signal.aborted) setStatus("error");
    } finally { inFlight.current = false; }
  }, [authorized, getToken]);

  useEffect(() => {
    if (authorized) void load(null, false);
    return () => controller.current?.abort();
  }, [authorized, load]);

  async function refreshEvents(deliveryId: string) {
    const requestId = ++auditSequence.current;
    setAuditStatus("loading"); setEvents([]);
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const nextEvents = await loadPilotDeliveryEvents(pilotApiUrl, token, deliveryId, new AbortController().signal);
      if (requestId === auditSequence.current) { setEvents(nextEvents); setAuditStatus("ready"); }
    } catch { if (requestId === auditSequence.current) setAuditStatus("error"); }
  }
  async function showEvents(deliveryId: string) {
    if (selectedId === deliveryId) { auditSequence.current++; setSelectedId(null); setEvents([]); setAuditStatus("idle"); return; }
    setSelectedId(deliveryId);
    await refreshEvents(deliveryId);
  }
  function beginAction(deliveryId: string, nextAction: "receive" | "approve" | "reject") {
    auditSequence.current++; setSelectedId(deliveryId); setEvents([]); setAuditStatus("idle"); setAction(nextAction); setConfirmed(false); setActionError(""); setActionMessage("");
    setWeightGrams(""); setReceiptCode(""); setReasonCode("material_not_received");
  }
  async function submitAction(deliveryId: string) {
    if (!action || !confirmed || saving || !capabilities) return;
    if (action === "receive" && !capabilities.receiptEnabled) return;
    if (action === "approve" && !capabilities.pointsEnabled) return;
    if (action === "reject" && !capabilities.decisionEnabled) return;
    setSaving(true); setActionError(""); setActionMessage("");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const signal = new AbortController().signal;
      if (action === "receive") await receivePilotDelivery(pilotApiUrl, token, deliveryId, signal);
      if (action === "approve") {
        const grams = Number(weightGrams);
        if (!Number.isSafeInteger(grams) || grams < 1 || grams > 100_000 || !/^[A-Za-z0-9_-]{8,64}$/.test(receiptCode)) {
          throw new PilotApiError(400, "invalid_physical_evidence");
        }
        await verifyPilotDelivery(pilotApiUrl, token, deliveryId, { decision: "approved", verifiedGrams: grams, receiptCode }, signal);
      }
      if (action === "reject") await verifyPilotDelivery(pilotApiUrl, token, deliveryId, { decision: "rejected", reasonCode }, signal);
      setAction(null); setConfirmed(false); setActionMessage("Operación registrada. El historial se actualizó.");
      await load(null, false); onRefresh(); await refreshEvents(deliveryId);
    } catch (cause) {
      const code = cause instanceof PilotApiError ? cause.code : "request_failed";
      setActionError(code === "already_verified" || code === "delivery_state_conflict"
        ? "La entrega cambió de estado. Actualiza la bandeja antes de intentar otra acción."
        : "No se pudo registrar la operación. Puedes reintentar; el servidor evita duplicados.");
    } finally { setSaving(false); }
  }

  if (!authorized) return null;
  return <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" aria-labelledby="verifier-queue-title" data-testid="verifier-delivery-queue">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><div className="flex items-center gap-2 text-[hsl(var(--primary))]"><ShieldCheck size={19} /><span className="text-xs font-bold uppercase tracking-[.14em]">Acceso autorizado</span></div>
        <h2 id="verifier-queue-title" className="mt-3 font-display text-3xl text-[hsl(var(--primary))]">Recepción y verificación</h2>
        <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">La cola omite nombres, correos e identificadores de cuenta. En la simulación, el operador registra recepción y peso académico; los estimados nunca conceden puntos.</p></div>
      <button type="button" onClick={() => void load(null, false)} disabled={status === "loading"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold disabled:opacity-60" data-testid="button-refresh-verifier-queue"><Clock3 size={16} /> Actualizar</button>
    </div>
    {capabilities && !capabilities.receiptEnabled && !capabilities.decisionEnabled && <p role="status" className="mt-4 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm">La recepción y verificación reales siguen desactivadas. Puedes consultar la bandeja y los eventos, sin modificar entregas ni puntos.</p>}
    <div className="mt-5" aria-live="polite" aria-busy={status === "loading"}>
      {status === "loading" && !items.length && <p className="rounded-2xl bg-[hsl(var(--muted))] p-5 text-sm">Cargando entregas pendientes…</p>}
      {status === "error" && <div className="rounded-2xl bg-red-50 p-5 text-sm text-red-900" role="alert"><p>No se pudo consultar la cola protegida.</p><button type="button" onClick={() => void load(null, false)} className="mt-3 font-bold underline">Intentar de nuevo</button></div>}
      {status === "ready" && !items.length && <p className="rounded-2xl bg-[hsl(var(--muted))] p-5 text-sm">No hay entregas para revisar.</p>}
      {actionError && <p role="alert" className="mb-3 text-sm text-red-800">{actionError}</p>}
      {actionMessage && <p role="status" className="mb-3 text-sm text-emerald-800">{actionMessage}</p>}
      <div className="space-y-3">{items.map((delivery) => <article key={delivery.id} className="rounded-2xl border border-[hsl(var(--border))] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Solicitud {delivery.id.slice(0, 8).toUpperCase()}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{formatDate(delivery.createdAt)} · V{delivery.requestVersion}</p></div><span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{deliveryLabels[delivery.status]}</span></div>
        {delivery.requestVersion === 2 && <ul className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{delivery.materials.map(material => <li key={material.categoryCode}>{materialLabels[material.categoryCode]}: {(material.estimatedGrams / 1000).toLocaleString("es-CO")} kg estimados</li>)}</ul>}
        <div className="mt-3 flex flex-wrap gap-3 text-sm"><button type="button" onClick={() => void showEvents(delivery.id)} className="underline">{selectedId === delivery.id ? "Ocultar auditoría" : "Ver auditoría"}</button>
          {(delivery.status === "pending" || delivery.status === "scheduled") && <button type="button" disabled={!capabilities?.receiptEnabled || saving} onClick={() => beginAction(delivery.id, "receive")} className="underline disabled:cursor-not-allowed disabled:opacity-50">Registrar recepción</button>}
          {delivery.status === "received" && <><button type="button" disabled={!capabilities?.pointsEnabled || saving} onClick={() => beginAction(delivery.id, "approve")} className="underline disabled:cursor-not-allowed disabled:opacity-50">Aprobar peso real</button><button type="button" disabled={!capabilities?.decisionEnabled || saving} onClick={() => beginAction(delivery.id, "reject")} className="underline disabled:cursor-not-allowed disabled:opacity-50">Rechazar</button></>}
        </div>
        {selectedId === delivery.id && <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
          {auditStatus === "loading" && <p className="text-sm">Cargando auditoría…</p>}
          {auditStatus === "error" && <p role="alert" className="text-sm text-red-800">No se pudo cargar el historial.</p>}
          {auditStatus === "ready" && events.length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))]">Esta solicitud no tiene eventos de estado registrados.</p>}
          {auditStatus === "ready" && events.length > 0 && <ol className="space-y-1 text-sm">{events.map((event, index) => <li key={`${event.createdAt}-${index}`}>{formatDate(event.createdAt)} · {deliveryLabels[event.toStatus]}{event.toStatus === "rejected" && event.reasonCode ? ` · ${rejectionLabels[event.reasonCode as RejectionReason] ?? "Motivo registrado"}` : ""}</li>)}</ol>}
          {action && <form onSubmit={event => { event.preventDefault(); void submitAction(delivery.id); }} className="mt-4 space-y-3 rounded-2xl bg-[hsl(var(--muted)/.65)] p-4">
            <h3 className="font-semibold">{action === "receive" ? "Registrar recepción académica" : action === "approve" ? "Aprobar peso verificado" : "Rechazar entrega"}</h3>
            {action === "approve" && <><label className="block text-sm">Peso real total (gramos)<input required type="number" min={1} max={100000} step={1} value={weightGrams} onChange={event => setWeightGrams(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-2" /></label><label className="block text-sm">Código de comprobante físico<input required minLength={8} maxLength={64} pattern="[A-Za-z0-9_-]{8,64}" value={receiptCode} onChange={event => setReceiptCode(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-2" /></label></>}
            {action === "reject" && <label className="block text-sm">Motivo<select value={reasonCode} onChange={event => setReasonCode(event.target.value as RejectionReason)} className="mt-1 min-h-11 w-full rounded-xl border p-2">{Object.entries(rejectionLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>}
            <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />Confirmo que esta decisión pertenece a la simulación académica y que no verifico mi propia solicitud.</label>
            <div className="flex flex-wrap gap-3"><button disabled={!confirmed || saving} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 py-2 font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{saving ? "Guardando…" : "Confirmar"}</button><button type="button" onClick={() => { setAction(null); setConfirmed(false); }} className="min-h-11 underline">Cancelar</button></div>
          </form>}
        </div>}
      </article>)}</div>
      {nextCursor && <button type="button" onClick={() => void load(nextCursor, true)} disabled={status === "loading"} className="mt-4 min-h-11 w-full rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold disabled:opacity-60" data-testid="button-load-more-deliveries">Cargar más</button>}
    </div>
  </section>;
}

function submissionMessage(error: unknown) {
  if (!(error instanceof PilotApiError)) return "No pudimos registrar la solicitud. Puedes reintentar sin crear un duplicado.";
  if (error.status === 401) return "Tu sesión venció. Inicia sesión nuevamente.";
  if (error.status === 429) return "Alcanzaste temporalmente el límite de solicitudes. Espera un momento y reintenta.";
  if (error.code === "idempotency_key_reused") return "La clave de reintento pertenece a datos diferentes. Revisa el formulario y vuelve a enviarlo.";
  if (error.code === "delivery_slot_unavailable" || error.code === "delivery_details_conflict") return "El horario dejó de estar disponible. Actualiza las opciones y selecciona otro horario.";
  if (error.code === "material_category_unavailable" || error.code === "delivery_point_unavailable") return "Una opción seleccionada dejó de estar disponible. Actualiza el formulario.";
  return "No pudimos registrar la solicitud. Puedes reintentar sin crear un duplicado.";
}

export function DeliveryPanel({ deliveries, role, onRefresh, showVerifierQueue = true }: { deliveries: PilotDelivery[]; role: string; onRefresh: () => void; showVerifierQueue?: boolean }) {
  const { getToken, userId } = useAuth();
  const [options, setOptions] = useState<PilotDeliveryOptions | null>(null);
  const [optionsStatus, setOptionsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [confirmed, setConfirmed] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [materialKg, setMaterialKg] = useState<Partial<Record<ManualScanCategory, string>>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const loadOptions = useCallback(async () => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setOptionsStatus("loading");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
       const loaded = await loadPilotDeliveryOptions(pilotApiUrl, token, requestController.signal);
       const params = new URLSearchParams(window.location.search);
       const requestedPoint = params.get("point");
       const available = loaded.points.find(point => point.id === requestedPoint);
       if (available) {
         setSelectedPointId(available.id);
         const requestedSlot = params.get("slot");
         setSelectedSlotId(available.slots.some(slot => slot.id === requestedSlot) ? requestedSlot! : "");
       }
       setOptions(loaded);
      setOptionsStatus("ready");
    } catch {
      if (!requestController.signal.aborted) setOptionsStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    void loadOptions();
    return () => controller.current?.abort();
  }, [loadOptions]);

  useEffect(() => {
    setOptions(null); setSelectedPointId(""); setSelectedSlotId(""); setMaterialKg({});
    setConfirmed(false); setMessage(""); setStatus("idle");
  }, [userId]);

  const selectedPoint = options?.points.find((point) => point.id === selectedPointId) ?? null;
  const selectedMaterials = useMemo(() => Object.entries(materialKg).flatMap(([categoryCode, rawKg]) => {
    const kg = Number(rawKg);
    return Number.isFinite(kg) && kg > 0
      ? [{ categoryCode: categoryCode as ManualScanCategory, estimatedGrams: Math.round(kg * 1000) }]
      : [];
  }).sort((left, right) => left.categoryCode.localeCompare(right.categoryCode)), [materialKg]);
  const estimatedTotal = selectedMaterials.reduce((sum, material) => sum + material.estimatedGrams, 0);
  const detailedValid = options?.mode === "detailed" && options.enabled && selectedMaterials.length > 0 && estimatedTotal <= 100_000 && Boolean(selectedPoint) &&
    (!selectedPoint?.materials || selectedMaterials.every(material => selectedPoint.materials?.includes(material.categoryCode))) &&
    (!selectedPoint?.appointmentRequired || Boolean(selectedSlotId));

  const operationKey = (signature: string) => {
    try {
       const stored = JSON.parse(sessionStorage.getItem(pendingOperationStorageKey(userId)) ?? "null") as { key?: unknown; signature?: unknown } | null;
      if (stored && typeof stored.key === "string" && idempotencyPattern.test(stored.key) && stored.signature === signature) return stored.key;
    } catch {
      // Replace malformed or unavailable session state with a new operation.
    }
    const key = `delivery_${crypto.randomUUID().replaceAll("-", "")}`;
    try { sessionStorage.setItem(pendingOperationStorageKey(userId), JSON.stringify({ key, signature })); } catch { /* Server idempotency remains authoritative. */ }
    return key;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || inFlight.current || !options) return;
    if (options.mode === "detailed" && !detailedValid) return;
    inFlight.current = true;
    setStatus("submitting");
    setMessage("Registrando una solicitud pendiente…");
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const payload: DetailedDeliveryRequest | null = options.mode === "detailed" ? {
        materials: selectedMaterials,
        deliveryPointId: selectedPointId,
        slotId: selectedSlotId || null,
      } : null;
      const signature = JSON.stringify(payload ?? {});
      const result = payload
        ? await createDetailedPilotDelivery(pilotApiUrl, token, operationKey(signature), payload, requestController.signal)
        : await createPilotDelivery(pilotApiUrl, token, operationKey(signature), requestController.signal);
       try { sessionStorage.removeItem(pendingOperationStorageKey(userId)); } catch { /* No persistent secret is stored. */ }
      setConfirmed(false);
      setMaterialKg({});
      setSelectedPointId("");
      setSelectedSlotId("");
      setStatus("success");
      setMessage(result.replayed
        ? "Recuperamos la misma solicitud pendiente; no se creó un duplicado."
        : "Solicitud registrada como pendiente. Las cantidades son estimadas y todavía no generan puntos.");
      onRefresh();
      void loadOptions();
    } catch (error) {
      if (!requestController.signal.aborted) {
        setStatus("error");
        setMessage(submissionMessage(error));
      }
    } finally {
      inFlight.current = false;
    }
  };

  const legacyMode = options?.mode === "legacy";
  const detailsUnavailable = options?.mode === "detailed" && !options.enabled;
  return <div className="mt-5 grid gap-5 lg:grid-cols-2">
    <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" aria-labelledby="delivery-request-title" data-testid="delivery-request-panel">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><PackageCheck size={21} /></span>
        <div><h2 id="delivery-request-title" className="font-display text-3xl text-[hsl(var(--primary))]">Solicitar entrega</h2><p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Registra una solicitud académica. La solicitud no confirma recepción ni concede puntos.</p></div>
      </div>

      {optionsStatus === "loading" && <p className="mt-6 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" aria-live="polite">Consultando centros y horarios disponibles…</p>}
      {optionsStatus === "error" && <div className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-900" role="alert"><p>No pudimos consultar la configuración de entregas.</p><button type="button" onClick={() => void loadOptions()} className="mt-2 font-bold underline">Intentar de nuevo</button></div>}
      {detailsUnavailable && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        <p className="font-semibold">Por ahora no hay horarios disponibles.</p>
        <p className="mt-1">Explora los centros en el mapa y vuelve más tarde para consultar nuevos horarios.</p>
        <button type="button" onClick={() => void loadOptions()} className="mt-3 font-bold underline">Actualizar disponibilidad</button>
      </div>}

      {optionsStatus === "ready" && options && !detailsUnavailable && <form onSubmit={submit} className="mt-6 space-y-5">
        {legacyMode && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <p className="font-semibold">Solicitud básica compatible</p>
          <p className="mt-1">Vuelve a consultar la disponibilidad más tarde.</p>
        </div>}

        {options.mode === "detailed" && <>
          <fieldset>
            <legend className="text-sm font-bold">1. Materiales y cantidades estimadas</legend>
             <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Selecciona entre 0,001 y 100 kg totales. El peso validado lo registrará un operador académico.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
               {options.categories.filter(({ code }) => !selectedPoint?.materials || selectedPoint.materials.includes(code)).map(({ code }) => {
                const selected = materialKg[code] !== undefined;
                return <div key={code} className="rounded-2xl border border-[hsl(var(--border))] p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selected} onChange={(event) => setMaterialKg((current) => event.target.checked ? { ...current, [code]: "1" } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== code)))} disabled={status === "submitting"} className="h-5 w-5 accent-[hsl(var(--primary))]" />{materialLabels[code]}</label>
                  {selected && <label className="mt-3 block text-xs font-semibold">Kilogramos estimados<input type="number" min="0.001" max="100" step="0.001" inputMode="decimal" value={materialKg[code] ?? ""} onChange={(event) => setMaterialKg((current) => ({ ...current, [code]: event.target.value }))} required className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-base" aria-label={`Kilogramos estimados de ${materialLabels[code]}`} /></label>}
                </div>;
              })}
            </div>
            <p className={`mt-2 text-xs ${estimatedTotal > 100_000 ? "font-semibold text-red-800" : "text-[hsl(var(--muted-foreground))]"}`}>Total estimado: {(estimatedTotal / 1000).toLocaleString("es-CO", { maximumFractionDigits: 3 })} kg</p>
          </fieldset>

          <div>
             <label htmlFor="delivery-point" className="text-sm font-bold">2. Centro académico</label>
             <div className="relative mt-2"><MapPin className="pointer-events-none absolute left-3 top-3.5 text-[hsl(var(--muted-foreground))]" size={18} /><select id="delivery-point" value={selectedPointId} onChange={(event) => { setSelectedPointId(event.target.value); setSelectedSlotId(""); setMaterialKg({}); }} required className="min-h-12 w-full appearance-none rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-10 pr-4 text-sm"><option value="">Selecciona un punto disponible</option>{options.points.map((point) => <option key={point.id} value={point.id}>{point.name} · {point.municipality}</option>)}</select></div>
            {selectedPoint && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{selectedPoint.address}, {selectedPoint.municipality}</p>}
          </div>

          {selectedPoint?.appointmentRequired && <div>
            <label htmlFor="delivery-slot" className="text-sm font-bold">3. Horario disponible</label>
            <div className="relative mt-2"><CalendarClock className="pointer-events-none absolute left-3 top-3.5 text-[hsl(var(--muted-foreground))]" size={18} /><select id="delivery-slot" value={selectedSlotId} onChange={(event) => setSelectedSlotId(event.target.value)} required className="min-h-12 w-full appearance-none rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-10 pr-4 text-sm"><option value="">Selecciona un horario</option>{selectedPoint.slots.map((slot) => <option key={slot.id} value={slot.id}>{formatDate(slot.startsAt)} · {slot.remainingCapacity} cupo{slot.remainingCapacity === 1 ? "" : "s"}</option>)}</select></div>
            {!selectedPoint.slots.length && <p className="mt-2 text-sm font-semibold text-amber-800">Este punto no tiene horarios disponibles.</p>}
          </div>}
        </>}

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] p-4 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={status === "submitting"} className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-confirm-delivery-request" />
           <span><strong className="block text-[hsl(var(--foreground))]">Entiendo el estado pendiente</strong><span className="mt-1 block text-[hsl(var(--muted-foreground))]">Las cantidades son estimadas y el operador académico deberá verificar la solicitud posteriormente.</span></span>
        </label>
        <button type="submit" disabled={!confirmed || status === "submitting" || (options.mode === "detailed" && !detailedValid)} className="min-h-12 w-full rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-55" data-testid="button-request-delivery">{status === "submitting" ? "Registrando…" : status === "error" ? "Reintentar solicitud" : "Registrar solicitud pendiente"}</button>
      </form>}
      <p className={`mt-4 min-h-6 text-sm ${status === "error" ? "text-red-800" : status === "success" ? "text-emerald-800" : "text-[hsl(var(--muted-foreground))]"}`} role={status === "error" ? "alert" : "status"} aria-live="polite" data-testid="delivery-request-status">{message}</p>
    </section>

    <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" aria-labelledby="delivery-history-title" data-testid="delivery-history-panel">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><h2 id="delivery-history-title" className="font-display text-3xl text-[hsl(var(--primary))]">Historial de entregas</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Información persistente y aislada de esta cuenta.</p></div>
        <button type="button" onClick={onRefresh} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold" data-testid="button-refresh-deliveries"><Clock3 size={16} /> Actualizar</button>
      </div>
      <DeliveryHistory deliveries={deliveries} />
    </section>

    {showVerifierQueue && <div className="lg:col-span-2"><VerifierQueue role={role} onRefresh={onRefresh} /></div>}
  </div>;
}
