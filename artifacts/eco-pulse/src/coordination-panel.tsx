import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";
import { CalendarClock, ClipboardList, MapPin, Send, ShieldCheck } from "lucide-react";
import {
  assignPilotCoordinationRequest,
  cancelPilotCoordinationRequest,
  createPilotCoordinationRequest,
  loadAdminCoordinationRequests,
  loadCoordinationRequests,
  loadPilotDeliveryOptions,
  loadPilotPublicPoints,
  PilotApiError,
  type PilotCoordinationRequest,
  type PilotDeliveryMaterial,
  type PilotDeliveryOptions,
  type CoordinationRequestInput,
} from "./pilot-api";
import { manualScanCategories, manualScanGuidance, type ManualScanCategory } from "./scan-catalog";

const coordinationStatusLabels: Record<PilotCoordinationRequest["status"], string> = {
  pending: "Pendiente de coordinación",
  assigned: "Centro asignado",
  cancelled: "Cancelada",
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function gramsToKg(grams: number) {
  return (grams / 1000).toLocaleString("es-CO", { maximumFractionDigits: 3 });
}

function CoordinationMaterials({ materials }: { materials: PilotDeliveryMaterial[] }) {
  return <ul className="mt-1 space-y-1 text-[hsl(var(--muted-foreground))]">
    {materials.map((material) => <li key={material.categoryCode}>
      {manualScanGuidance[material.categoryCode]?.label ?? material.categoryCode}: {gramsToKg(material.estimatedGrams)} kg estimados
    </li>)}
  </ul>;
}

function CoordinationHistory({ request }: { request: PilotCoordinationRequest }) {
  const [expanded, setExpanded] = useState(false);
  return <article className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`coordination-request-${request.id}`}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="font-semibold">Solicitud {request.id.slice(0, 8).toUpperCase()}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{formatTimestamp(request.createdAt)}</p>
      </div>
      <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${request.status === "assigned" ? "bg-emerald-100 text-emerald-900" : request.status === "cancelled" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>{coordinationStatusLabels[request.status]}</span>
    </div>
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div><p className="font-semibold">Materiales y cantidades</p><CoordinationMaterials materials={request.materials} /></div>
      <div>
        <p className="font-semibold">Destino</p>
        {request.requestedPointName && <p>Centro solicitado: {request.requestedPointName}. Preferencia, no reserva confirmada.</p>}
        {request.preferredAt && <p>Fecha preferida: {formatTimestamp(request.preferredAt)} (por confirmar)</p>}
        {request.assignedPoint
          ? <p className="mt-1 text-[hsl(var(--muted-foreground))]">{request.assignedPoint.name}, {request.assignedPoint.municipality}</p>
          : <p className="mt-1 text-[hsl(var(--muted-foreground))]">Sin centro asignado. Esta solicitud no reserva centro ni confirma recepción.</p>}
        {request.deliveryId && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Entrega vinculada: {request.deliveryId.slice(0, 8).toUpperCase()}{request.deliveryStatus ? ` · ${request.deliveryStatus}` : ""}</p>}
      </div>
    </div>
    {request.note && <p className="mt-3 rounded-xl bg-[hsl(var(--muted))] p-3 text-sm">Nota: {request.note}</p>}
    <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-3 text-sm font-semibold underline">
      {expanded ? "Ocultar historial" : "Ver historial"}
    </button>
    {expanded && <ol className="mt-2 space-y-1 text-sm text-[hsl(var(--muted-foreground))]">
      {request.events.length === 0 && <li>Sin eventos registrados.</li>}
      {request.events.map((event, index) => <li key={`${event.createdAt}-${index}`}>
        {formatTimestamp(event.createdAt)} · {coordinationStatusLabels[event.toStatus]}
      </li>)}
    </ol>}
  </article>;
}

/**
 * Participant fallback when no verified center is available. It records a
 * pending coordination request only: no center, receipt or EcoPuntos are
 * claimed until an administrator assigns a published center.
 */
export function CoordinationRequestsPanel({ apiUrl, allowCreate }: { apiUrl: string; allowCreate: boolean }) {
  const { getToken, userId } = useAuth();
  const [items, setItems] = useState<PilotCoordinationRequest[]>([]);
  const [schemaReady, setSchemaReady] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [materialKg, setMaterialKg] = useState<Partial<Record<ManualScanCategory, string>>>({});
  const [note, setNote] = useState("");
  const [points, setPoints] = useState<PilotDeliveryOptions["points"]>([]);
  const [requestedPointId, setRequestedPointId] = useState("");
  const [preferredAt, setPreferredAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submitMessage, setSubmitMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const pendingPayload = useRef<CoordinationRequestInput | null>(null);
  const submissionController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const requestId = ++loadRequestId.current;
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const [result, published] = await Promise.all([
        loadCoordinationRequests(apiUrl, token, controller.signal),
        loadPilotPublicPoints(apiUrl, token, controller.signal),
      ]);
      if (controller.signal.aborted || loadRequestId.current !== requestId) return;
      setItems(result.items);
      setPoints(published);
      setSchemaReady(result.schemaReady);
      setStatus("ready");
    } catch {
      if (!controller.signal.aborted && loadRequestId.current === requestId) setStatus("error");
    }
  }, [apiUrl, getToken]);

  useEffect(() => {
    setItems([]); setStatus("loading"); setSchemaReady(true);
    setMaterialKg({}); setNote(""); setConfirmed(false);
    setRequestedPointId(new URLSearchParams(window.location.search).get("point") ?? ""); setPreferredAt("");
    setSubmitStatus("idle"); setSubmitMessage(""); setListMessage("");
    idempotencyKey.current = null;
    pendingPayload.current = null;
    void load();
    return () => { loadController.current?.abort(); submissionController.current?.abort(); };
  }, [load, userId]);

  const selectedMaterials = useMemo(() => Object.entries(materialKg).flatMap(([categoryCode, rawKg]) => {
    const kg = Number(rawKg);
    return Number.isFinite(kg) && kg > 0
      ? [{ categoryCode: categoryCode as ManualScanCategory, estimatedGrams: Math.round(kg * 1000) }]
      : [];
  }).sort((left, right) => left.categoryCode.localeCompare(right.categoryCode)), [materialKg]);
  const totalGrams = selectedMaterials.reduce((sum, material) => sum + material.estimatedGrams, 0);
  const formValid = selectedMaterials.length > 0 && totalGrams <= 100_000 && note.length <= 500 && confirmed;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!formValid || inFlight.current) return;
    inFlight.current = true;
    setSubmitStatus("submitting");
    setSubmitMessage("");
    const controller = new AbortController();
    submissionController.current = controller;
    try {
      const token = await getToken();
      if (controller.signal.aborted) return;
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const key = idempotencyKey.current ?? `coord_${crypto.randomUUID()}`;
      idempotencyKey.current = key;
      const payload = pendingPayload.current ?? {
        materials: selectedMaterials,
        note: note.trim() ? note.trim() : null,
        requestedPointId: requestedPointId || null,
        preferredAt: preferredAt ? new Date(preferredAt).toISOString() : null,
      };
      pendingPayload.current = payload;
      const result = await createPilotCoordinationRequest(apiUrl, token, key, payload, controller.signal);
      if (controller.signal.aborted) return;
      idempotencyKey.current = null;
      pendingPayload.current = null;
      setSubmitStatus("success");
      setSubmitMessage(result.replayed
        ? "Recuperamos la misma solicitud; no se creó un duplicado."
        : "Solicitud de coordinación registrada como pendiente. No reserva centro ni confirma recepción.");
      setMaterialKg({}); setNote(""); setConfirmed(false);
      await load();
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof PilotApiError ? error.code : "";
      const httpStatus = error instanceof PilotApiError ? error.status : 0;
      if (httpStatus === 400 || httpStatus === 409) { idempotencyKey.current = null; pendingPayload.current = null; }
      setSubmitStatus("error");
      setSubmitMessage(httpStatus === 401
        ? "Tu sesión venció. Inicia sesión nuevamente."
        : httpStatus === 429
          ? "Alcanzaste el límite temporal de solicitudes. Espera un momento e inténtalo de nuevo."
          : code === "coordination_migration_required" || code === "coordination_requests_disabled"
            ? "La coordinación de entregas aún no está habilitada en el servidor."
            : "No pudimos registrar la solicitud. Puedes reintentar sin crear un duplicado.");
    } finally {
      inFlight.current = false;
    }
  };

  const cancel = async (requestId: string) => {
    if (busyId) return;
    if (!window.confirm("¿Cancelar esta solicitud de coordinación?")) return;
    setBusyId(requestId);
    setListMessage("");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      await cancelPilotCoordinationRequest(apiUrl, token, requestId, new AbortController().signal);
      setListMessage("Solicitud de coordinación cancelada.");
      await load();
    } catch (error) {
      const code = error instanceof PilotApiError ? error.code : "";
      setListMessage(code === "coordination_already_assigned"
        ? "La solicitud ya fue asignada a un centro y no se puede cancelar."
        : "No pudimos cancelar la solicitud. Actualiza el historial e inténtalo de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleMaterial = (code: ManualScanCategory, checked: boolean) => {
    setMaterialKg((current) => checked
      ? { ...current, [code]: current[code] ?? "1" }
      : Object.fromEntries(Object.entries(current).filter(([key]) => key !== code)));
  };

  return <section className="mt-5 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" aria-labelledby="coordination-title" data-testid="coordination-request-panel">
    <div className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><ClipboardList size={21} /></span>
      <div>
        <h2 id="coordination-title" className="font-display text-3xl text-[hsl(var(--primary))]">Solicitar coordinación de entrega</h2>
        <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Cuando no hay un centro autorizado disponible, registra tu intención. Administración podrá asignarte un centro publicado; hasta entonces la solicitud sigue pendiente y no genera EcoPuntos.</p>
      </div>
    </div>

    {!schemaReady && <p className="mt-5 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" role="status">La coordinación de entregas todavía no está habilitada en este entorno.</p>}

    {allowCreate && schemaReady && <form onSubmit={submit} className="mt-5 space-y-4" data-testid="form-coordination-request">
      <fieldset disabled={submitStatus === "submitting" || pendingPayload.current !== null} className="space-y-4">
      <label className="block text-sm font-semibold">Centro al que deseas entregar<select disabled={submitStatus === "submitting"} value={requestedPointId} onChange={event => setRequestedPointId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border bg-[hsl(var(--background))] p-3"><option value="">Solicitar orientación sin centro elegido</option>{points.map(point => <option key={point.id} value={point.id}>{point.name} · {point.municipality}</option>)}</select></label>
      <label className="block text-sm font-semibold">Fecha y hora preferidas (no confirmadas)<input type="datetime-local" disabled={submitStatus === "submitting"} value={preferredAt} onChange={event => setPreferredAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border bg-[hsl(var(--background))] p-3" /></label>
      <fieldset disabled={submitStatus === "submitting"}>
        <legend className="text-sm font-bold">Materiales y cantidades estimadas</legend>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Selecciona entre 0,001 y 100 kg totales. Un operador autorizado validará el peso real en el centro asignado.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {manualScanCategories.map((code) => {
            const selected = materialKg[code] !== undefined;
            return <div key={code} className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selected} onChange={(event) => toggleMaterial(code, event.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" />{manualScanGuidance[code].label}</label>
              {selected && <label className="mt-3 block text-xs font-semibold">Kilogramos estimados<input type="number" min="0.001" max="100" step="0.001" inputMode="decimal" required value={materialKg[code] ?? ""} onChange={(event) => setMaterialKg((current) => ({ ...current, [code]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-base" aria-label={`Kilogramos estimados de ${manualScanGuidance[code].label}`} /></label>}
            </div>;
          })}
        </div>
        <p className={`mt-2 text-xs ${totalGrams > 100_000 ? "font-semibold text-red-800" : "text-[hsl(var(--muted-foreground))]"}`}>Total estimado: {gramsToKg(totalGrams)} kg</p>
      </fieldset>
      <label className="block text-sm font-semibold">Nota para administración (opcional)<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm" placeholder="Municipio, disponibilidad o detalles de coordinación" /></label>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] p-4 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-confirm-coordination" />
        <span><strong className="block">Entiendo que esta solicitud no reserva centro</strong><span className="mt-1 block text-[hsl(var(--muted-foreground))]">No confirma recepción ni concede EcoPuntos. La asignación de centro la realiza administración con centros publicados.</span></span>
      </label>
      </fieldset>
      <button type="submit" disabled={!formValid || submitStatus === "submitting"} className="min-h-12 w-full rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-55" data-testid="button-submit-coordination">{submitStatus === "submitting" ? "Registrando…" : submitStatus === "error" ? "Reintentar solicitud" : "Registrar solicitud de coordinación"}</button>
      <p className={`min-h-6 text-sm ${submitStatus === "error" ? "text-red-800" : submitStatus === "success" ? "text-emerald-800" : "text-[hsl(var(--muted-foreground))]"}`} role={submitStatus === "error" ? "alert" : "status"} aria-live="polite" data-testid="coordination-submit-status">{submitMessage}</p>
    </form>}

    <div className="mt-6 border-t border-[hsl(var(--border))] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Mis solicitudes de coordinación</h3>
        <button type="button" onClick={() => void load()} className="min-h-11 rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold" data-testid="button-refresh-coordination">Actualizar</button>
      </div>
      {status === "loading" && <p className="mt-4 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" aria-live="polite">Consultando solicitudes…</p>}
      {status === "error" && <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-900" role="alert"><p>No pudimos consultar tus solicitudes de coordinación.</p><button type="button" onClick={() => void load()} className="mt-2 font-bold underline">Intentar de nuevo</button></div>}
      {listMessage && <p role="status" className="mt-3 text-sm">{listMessage}</p>}
      {status === "ready" && <div className="mt-4 space-y-3">
        {items.map((request) => <div key={request.id}>
          <CoordinationHistory request={request} />
          {request.status === "pending" && <div className="mt-2 flex justify-end">
            <button type="button" disabled={busyId === request.id} onClick={() => void cancel(request.id)} className="text-sm font-semibold text-red-800 underline disabled:opacity-50" data-testid={`button-cancel-coordination-${request.id}`}>{busyId === request.id ? "Cancelando…" : "Cancelar solicitud"}</button>
          </div>}
        </div>)}
        {!items.length && <p className="rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" data-testid="empty-coordination-requests">Aún no tienes solicitudes de coordinación.</p>}
      </div>}
    </div>
    {items.some((request) => request.status === "assigned") && <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Cuando un centro te sea asignado, la entrega aparecerá también en tu historial de entregas.</p>}
  </section>;
}

function AssignmentForm({ apiUrl, request, options, onAssigned }: { apiUrl: string; request: PilotCoordinationRequest; options: PilotDeliveryOptions; onAssigned: () => Promise<void> | void }) {
  const { getToken } = useAuth();
  const [pointId, setPointId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const point = options.points.find((candidate) => candidate.id === pointId) ?? null;
  const compatible = options.points.filter((candidate) =>
    request.materials.every((material) => candidate.materials?.includes(material.categoryCode)));
  const valid = Boolean(point) && (!point?.appointmentRequired || Boolean(slotId));

  const assign = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      await assignPilotCoordinationRequest(apiUrl, token, request.id, { deliveryPointId: pointId, slotId: point?.appointmentRequired ? slotId : null }, new AbortController().signal);
      setMessage("Centro asignado. La entrega quedó registrada en el flujo normal.");
      setPointId("");
      setSlotId("");
      await onAssigned();
    } catch (error) {
      const code = error instanceof PilotApiError ? error.code : "";
      setMessage(code === "material_category_unavailable"
        ? "El centro no acepta todos los materiales solicitados."
        : code === "delivery_slot_unavailable" || code === "delivery_slot_required"
          ? "El horario seleccionado no está disponible."
          : code === "coordination_already_assigned"
            ? "La solicitud ya fue asignada por otra persona."
            : "No pudimos asignar el centro. Actualiza los datos e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  if (!compatible.length) return <p className="mt-3 text-sm text-amber-900" role="status">No hay centros publicados que acepten todos los materiales de esta solicitud.</p>;
  return <form onSubmit={assign} className="mt-4 space-y-3 rounded-2xl bg-[hsl(var(--muted)/.65)] p-4" data-testid={`form-assign-coordination-${request.id}`}>
    <p className="text-sm font-semibold">Asignar centro publicado</p>
    <label className="block text-sm">Centro
      <select value={pointId} onChange={(event) => { setPointId(event.target.value); setSlotId(""); }} required className="mt-1 min-h-11 w-full rounded-xl border p-2">
        <option value="">Selecciona un centro</option>
        {compatible.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.municipality}</option>)}
      </select>
    </label>
    {point?.appointmentRequired && <label className="block text-sm">Horario con cupo
      <select value={slotId} onChange={(event) => setSlotId(event.target.value)} required className="mt-1 min-h-11 w-full rounded-xl border p-2">
        <option value="">Selecciona un horario</option>
        {point.slots.map((slot) => <option key={slot.id} value={slot.id}>{formatTimestamp(slot.startsAt)} · {slot.remainingCapacity} cupo{slot.remainingCapacity === 1 ? "" : "s"}</option>)}
      </select>
    </label>}
    <button type="submit" disabled={!valid || busy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-2 font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid={`button-assign-coordination-${request.id}`}><Send size={16} /> {busy ? "Asignando…" : "Asignar centro"}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

/**
 * Administrative inbox for pending coordination requests. Assignment creates
 * a real V2 delivery; receipt, verification and EcoPuntos keep using the
 * existing physical flow and are never implied here.
 */
export function CoordinationAdminPanel({ apiUrl }: { apiUrl: string }) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<PilotCoordinationRequest[]>([]);
  const [options, setOptions] = useState<PilotDeliveryOptions | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [schemaReady, setSchemaReady] = useState(true);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const [requests, deliveryOptions] = await Promise.all([
        loadAdminCoordinationRequests(apiUrl, token, requestController.signal),
        loadPilotDeliveryOptions(apiUrl, token, requestController.signal),
      ]);
      if (requestController.signal.aborted) return;
      setItems(requests.items);
      setSchemaReady(requests.schemaReady);
      setOptions(deliveryOptions);
      setStatus("ready");
    } catch {
      if (!requestController.signal.aborted) setStatus("error");
    }
  }, [apiUrl, getToken]);

  useEffect(() => {
    setItems([]); setOptions(null); setStatus("loading"); setSchemaReady(true);
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const pending = items.filter((request) => request.status === "pending");
  const resolved = items.filter((request) => request.status !== "pending");
  const centersAvailable = Boolean(options?.mode === "detailed" && options.enabled && options.points.length);

  return <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" aria-labelledby="coordination-admin-title" data-testid="admin-coordination-panel">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div>
        <div className="flex items-center gap-2 text-[hsl(var(--primary))]"><ShieldCheck size={19} /><span className="text-xs font-bold uppercase tracking-[.14em]">Solo administración</span></div>
        <h2 id="coordination-admin-title" className="mt-3 font-display text-3xl text-[hsl(var(--primary))]">Solicitudes de coordinación</h2>
        <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">Asigna un centro publicado a solicitudes que aún no tienen destino. La asignación crea una entrega pendiente; la recepción, verificación y EcoPuntos siguen el flujo físico existente.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={status === "loading"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold disabled:opacity-60" data-testid="button-refresh-admin-coordination"><CalendarClock size={16} /> Actualizar</button>
    </div>

    {!schemaReady && <p className="mt-4 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" role="status">La migración de coordinación todavía no está aplicada en este entorno.</p>}
    {status === "loading" && <p className="mt-4 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" aria-live="polite">Consultando solicitudes…</p>}
    {status === "error" && <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-900" role="alert"><p>No pudimos consultar las solicitudes de coordinación.</p><button type="button" onClick={() => void load()} className="mt-2 font-bold underline">Intentar de nuevo</button></div>}
    {status === "ready" && !centersAvailable && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">No hay centros publicados y operativamente validados. Publica un centro autorizado antes de asignar solicitudes; no se inventará disponibilidad.</p>}
    {status === "ready" && <div className="mt-5 space-y-4">
      <h3 className="font-semibold">Pendientes ({pending.length})</h3>
      {!pending.length && <p className="rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" data-testid="empty-admin-coordination-pending">No hay solicitudes pendientes de coordinación.</p>}
      {pending.map((request) => <article key={request.id} className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`admin-coordination-request-${request.id}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-semibold">Solicitud {request.id.slice(0, 8).toUpperCase()}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{formatTimestamp(request.createdAt)}{request.accountId ? ` · Cuenta ${request.accountId.slice(0, 10)}…` : ""}</p>
          </div>
          <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Pendiente</span>
        </div>
        <div className="mt-3 text-sm"><p className="font-semibold">Materiales y cantidades</p><CoordinationMaterials materials={request.materials} /></div>
        {request.requestedPointName && <p className="mt-2 text-sm">Centro solicitado: {request.requestedPointName} (por confirmar)</p>}
        {request.preferredAt && <p className="text-sm">Preferencia: {formatTimestamp(request.preferredAt)}</p>}
        {request.note && <p className="mt-3 rounded-xl bg-[hsl(var(--muted))] p-3 text-sm">Nota: {request.note}</p>}
        {centersAvailable && options && <AssignmentForm apiUrl={apiUrl} request={request} options={options} onAssigned={load} />}
      </article>)}
      {resolved.length > 0 && <details className="rounded-2xl border border-[hsl(var(--border))] p-4">
        <summary className="cursor-pointer font-semibold">Historial reciente ({resolved.length})</summary>
        <div className="mt-3 space-y-3">{resolved.slice(0, 20).map((request) => <CoordinationHistory key={request.id} request={request} />)}</div>
      </details>}
    </div>}
    <p className="mt-4 flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]"><MapPin size={14} className="mt-0.5 shrink-0" /> Solo se ofrecen centros publicados con validación operativa y cupos reales.</p>
  </section>;
}
