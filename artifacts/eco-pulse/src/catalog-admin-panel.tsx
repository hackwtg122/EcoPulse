import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";

type Point = { id: string; code: string; name: string; address: string; municipality: string; timeZone: string; appointmentRequired: boolean; active: boolean; validationReference: string | null; validatedAt: string | null };
type Slot = { id: string; pointId: string; startsAt: string; endsAt: string; capacity: number; remainingCapacity: number; active: boolean; validationReference: string | null; validatedAt: string | null };
type Catalog = { points: Point[]; slots: Slot[]; editingEnabled: boolean; validationReady: boolean; publishingEnabled: boolean };
type AdminStats = { users: number; scans: number; deliveriesByStatus: Array<{ status: string; total: number }>; redemptionsByFulfillment: Array<{ fulfillmentStatus: string | null; total: number }>; pointsBalance: number };
const apiUrl = import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001";
const emptyPoint = { code: "", name: "", address: "", municipality: "", timeZone: "America/Bogota", appointmentRequired: true };
const emptySlot = { pointId: "", startsAt: "", endsAt: "", capacity: "" };
const candidateLocations = [
  { name: "ASO-RECICLADOR ESP", address: "Cra. 43 # 27-103, Villa Caribe, Montería", source: "https://asorecicladoresp.com/", map: "https://www.openstreetmap.org/way/1486874125", note: "OSM identifica un edificio con ese nombre; el punto es orientativo y requiere confirmación en terreno." },
  { name: "RECICOL", address: "Calle 29 # 41-64, Villa Caribe, Montería", source: "https://recicol.com/contactos", map: null, note: "Sin coordenada independiente confirmada: abrir búsqueda por dirección en OSM y comprobarla con el operador." },
] as const;
function localInputDate(value: string) {
  const date = new Date(value);
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function CatalogAdminPanel({ role }: { role: string | undefined }) {
  const { getToken } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [point, setPoint] = useState(emptyPoint);
  const [slot, setSlot] = useState(emptySlot);
  const [pointEditId, setPointEditId] = useState<string | null>(null);
  const [slotEditId, setSlotEditId] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ kind: "points" | "slots"; id: string; reference: string } | null>(null);
  const [capacityEdit, setCapacityEdit] = useState<{ id: string; capacity: string; reference: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (role !== "admin") return;
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) throw new Error("session_required");
      const response = await fetch(`${apiUrl}/api/pilot/admin/catalog`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
      if (!response.ok) throw new Error("catalog_unavailable");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !Array.isArray((body as Catalog).points) || !Array.isArray((body as Catalog).slots)) throw new Error("catalog_invalid");
      if (!signal?.aborted) { setCatalog(body as Catalog); setStatus("ready"); setError(""); }
      // Statistics are auxiliary: a failure here never blocks catalog editing.
      try {
        const statsResponse = await fetch(`${apiUrl}/api/pilot/admin/stats`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
        if (statsResponse.ok) {
          const statsBody: unknown = await statsResponse.json();
          const candidate = statsBody as AdminStats;
          if (!signal?.aborted && candidate && Number.isSafeInteger(candidate.users) && Number.isSafeInteger(candidate.scans) &&
              Array.isArray(candidate.deliveriesByStatus) && Array.isArray(candidate.redemptionsByFulfillment) && Number.isSafeInteger(candidate.pointsBalance)) {
            setStats(candidate); setStatsError(false);
          } else if (!signal?.aborted) setStatsError(true);
        } else if (!signal?.aborted) setStatsError(true);
      } catch { if (!signal?.aborted) setStatsError(true); }
    } catch {
      if (!signal?.aborted) { setStatus("error"); setError("No pudimos cargar el catálogo administrativo."); }
    }
  }, [getToken, role]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);

  async function request(method: "POST" | "PATCH", endpoint: string, payload: object) {
    const token = await getToken();
    if (!token) throw new Error("session_required");
    const response = await fetch(`${apiUrl}/api/pilot/admin/catalog/${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store",
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => ({}));
      throw new Error(body && typeof body === "object" && "error" in body ? String(body.error) : "request_failed");
    }
  }
  async function runAction(action: () => Promise<void>, confirmation: string) {
    if (saving) return;
    setSaving(true); setError(""); setSuccess("");
    try { await action(); await refresh(); setSuccess(confirmation); }
    catch (cause) {
      const code = cause instanceof Error ? cause.message : "request_failed";
      setError(({ point_code_exists: "Ya existe un centro con ese código.", slot_window_overlaps: "Ese horario se solapa con otro.", catalog_constraint_conflict: "La operación contradice una reserva, disponibilidad o regla de validación.", point_validation_conflict: "El centro ya fue validado con otra referencia.", slot_validation_conflict: "El horario ya fue validado con otra referencia." } as Record<string, string>)[code] || "No pudimos guardar el cambio. Comprueba los datos y vuelve a intentar.");
    } finally { setSaving(false); }
  }
  function submitPoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog?.editingEnabled) return;
    const endpoint = pointEditId ? `points/${pointEditId}` : "points";
    const payload = pointEditId ? { name: point.name, address: point.address, municipality: point.municipality, timeZone: point.timeZone, appointmentRequired: point.appointmentRequired } : point;
    void runAction(async () => { await request(pointEditId ? "PATCH" : "POST", endpoint, payload); setPoint(emptyPoint); setPointEditId(null); }, "Borrador de centro guardado.");
  }
  function submitSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog?.editingEnabled) return;
    const endpoint = slotEditId ? `slots/${slotEditId}` : "slots";
    const payload = { ...(slotEditId ? {} : { pointId: slot.pointId }), startsAt: new Date(slot.startsAt).toISOString(), endsAt: new Date(slot.endsAt).toISOString(), capacity: Number(slot.capacity) };
    void runAction(async () => { await request(slotEditId ? "PATCH" : "POST", endpoint, payload); setSlot(emptySlot); setSlotEditId(null); }, "Borrador de horario guardado.");
  }
  if (role !== "admin") return <div role="alert">Acceso restringido a administradores.</div>;
  return <div className="space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Administración</p><h1 className="mt-2 font-display text-4xl text-[hsl(var(--primary))]">Centros y horarios</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Los borradores no aparecen a los participantes. Publicar exige evidencia verificable y un horario con capacidad confirmada. El horario de atención de una sede no equivale a disponibilidad de EcoPulse.</p></header>
    {stats && <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" aria-labelledby="admin-stats-title" data-testid="admin-stats">
      <h2 id="admin-stats-title" className="font-display text-2xl">Resumen operativo</h2>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Conteos agregados del servidor. No incluye datos personales ni exportaciones.</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Participantes</dt><dd className="mt-1 font-display text-3xl text-[hsl(var(--primary))]" data-testid="admin-stat-users">{stats.users}</dd></div>
        <div className="rounded-xl border p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Escaneos registrados</dt><dd className="mt-1 font-display text-3xl text-[hsl(var(--primary))]" data-testid="admin-stat-scans">{stats.scans}</dd></div>
        <div className="rounded-xl border p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Saldo EcoPuntos en circulación</dt><dd className="mt-1 font-display text-3xl text-[hsl(var(--primary))]" data-testid="admin-stat-points">{stats.pointsBalance}</dd></div>
      </dl>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><h3 className="text-sm font-bold">Entregas por estado</h3><ul className="mt-1 space-y-1 text-sm" data-testid="admin-stat-deliveries">{stats.deliveriesByStatus.map(row => <li key={row.status}>{row.status}: {row.total}</li>)}{!stats.deliveriesByStatus.length && <li>Sin entregas registradas.</li>}</ul></div>
        <div><h3 className="text-sm font-bold">Canjes por estado de cumplimiento</h3><ul className="mt-1 space-y-1 text-sm" data-testid="admin-stat-redemptions">{stats.redemptionsByFulfillment.map(row => <li key={row.fulfillmentStatus ?? "none"}>{row.fulfillmentStatus ?? "sin estado"}: {row.total}</li>)}{!stats.redemptionsByFulfillment.length && <li>Sin canjes registrados.</li>}</ul></div>
      </div>
    </section>}
    {statsError && <p role="status" className="rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm">El resumen operativo no está disponible en este momento. El catálogo sigue funcionando con normalidad.</p>}
    <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" aria-labelledby="candidate-locations-title"><h2 id="candidate-locations-title" className="font-display text-2xl">Ubicaciones candidatas</h2><p className="mt-2 text-sm">Referencias para revisión administrativa. No son centros autorizados de EcoPulse y no permiten reservas.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{candidateLocations.map(candidate => <article key={candidate.name} className="rounded-xl border p-4 text-sm"><h3 className="font-semibold">{candidate.name}</h3><p className="mt-1">{candidate.address}</p><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{candidate.note}</p><div className="mt-3 flex flex-wrap gap-3"><a href={candidate.source} target="_blank" rel="noopener noreferrer" className="underline">Fuente del operador</a><a href={candidate.map ?? `https://www.openstreetmap.org/search?query=${encodeURIComponent(candidate.address)}`} target="_blank" rel="noopener noreferrer" className="underline">{candidate.map ? "Ver objeto OSM" : "Buscar en OSM"}</a></div></article>)}</div></section>
    {status === "loading" && <p aria-live="polite">Cargando catálogo…</p>}
    {status === "error" && <div role="alert">{error}<button type="button" onClick={() => void refresh()} className="ml-3 underline">Reintentar</button></div>}
    {status === "ready" && catalog && <>
      {!catalog.editingEnabled && <p role="status" className="rounded-2xl bg-[hsl(var(--muted))] p-4">La edición administrativa está desactivada. No se pueden crear ni modificar borradores todavía.</p>}
       {!catalog.validationReady && <p role="status" className="rounded-2xl bg-[hsl(var(--muted))] p-4">La edición de estos centros aún no está disponible.</p>}
       {!catalog.publishingEnabled && <p role="status" className="rounded-2xl bg-[hsl(var(--muted))] p-4">La publicación de nuevos centros aún no está disponible.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}{success && <p role="status" className="text-green-800">{success}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={submitPoint} className="space-y-3 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><h2 className="font-display text-2xl">{pointEditId ? "Editar centro en borrador" : "Nuevo centro en borrador"}</h2>
          {!pointEditId && <label className="block text-sm font-semibold">Código único<input required maxLength={64} pattern="[a-z0-9][a-z0-9_-]{2,63}" value={point.code} onChange={event => setPoint(current => ({ ...current, code: event.target.value }))} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] p-2" /></label>}
          {(["name", "address", "municipality"] as const).map(field => <label key={field} className="block text-sm font-semibold"><span>{{ name: "Nombre del centro", address: "Dirección comprobada", municipality: "Municipio" }[field]}</span><input required maxLength={{ name: 160, address: 240, municipality: 120 }[field]} value={point[field]} onChange={event => setPoint(current => ({ ...current, [field]: event.target.value }))} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] p-2" /></label>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={point.appointmentRequired} onChange={event => setPoint(current => ({ ...current, appointmentRequired: event.target.checked }))} /> EcoPulse exigirá un horario validado con cupo</label>
          <div className="flex flex-wrap gap-2"><button disabled={!catalog.editingEnabled || saving || (Boolean(pointEditId) && !catalog.validationReady)} className="rounded-full bg-[hsl(var(--primary))] px-5 py-2 text-[hsl(var(--primary-foreground))] disabled:opacity-50">Guardar borrador</button>{pointEditId && <button type="button" onClick={() => { setPoint(emptyPoint); setPointEditId(null); }} className="rounded-full border px-5 py-2">Cancelar</button>}</div>
        </form>
        <form onSubmit={submitSlot} className="space-y-3 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><h2 className="font-display text-2xl">{slotEditId ? "Editar horario en borrador" : "Nuevo horario en borrador"}</h2><p className="text-sm text-[hsl(var(--muted-foreground))]">Registra únicamente una franja y capacidad confirmadas por el centro. Su horario general de atención no demuestra cupos.</p>
          {!slotEditId && <label className="block text-sm font-semibold">Centro<select required value={slot.pointId} onChange={event => setSlot(current => ({ ...current, pointId: event.target.value }))} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] p-2"><option value="">Selecciona un centro registrado</option>{catalog.points.filter(item => item.appointmentRequired).map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>}
          <label className="block text-sm font-semibold">Inicio<input required type="datetime-local" value={slot.startsAt} onChange={event => setSlot(current => ({ ...current, startsAt: event.target.value }))} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] p-2" /></label>
          <label className="block text-sm font-semibold">Fin<input required type="datetime-local" value={slot.endsAt} onChange={event => setSlot(current => ({ ...current, endsAt: event.target.value }))} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] p-2" /></label>
          <label className="block text-sm font-semibold">Capacidad máxima<input required min={1} max={1000} step={1} type="number" value={slot.capacity} onChange={event => setSlot(current => ({ ...current, capacity: event.target.value }))} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] p-2" /></label>
          <div className="flex flex-wrap gap-2"><button disabled={!catalog.editingEnabled || saving || (Boolean(slotEditId) && !catalog.validationReady) || (!slotEditId && !catalog.points.some(item => item.appointmentRequired))} className="rounded-full bg-[hsl(var(--primary))] px-5 py-2 text-[hsl(var(--primary-foreground))] disabled:opacity-50">Guardar borrador</button>{slotEditId && <button type="button" onClick={() => { setSlot(emptySlot); setSlotEditId(null); }} className="rounded-full border px-5 py-2">Cancelar</button>}</div>
        </form>
      </div>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><h2 className="font-display text-2xl">Centros registrados</h2><div className="mt-3 space-y-2">{catalog.points.map(item => <div key={item.id} className="border-t border-[hsl(var(--border))] py-3 text-sm"><p><strong>{item.name}</strong> · {item.municipality} · {item.code} · {item.active ? "Activo" : "Borrador"}</p>{item.active && item.validationReference?.startsWith("https://") && <a href={item.validationReference} target="_blank" rel="noopener noreferrer" className="underline">Ver evidencia de validación</a>}<div className="mt-2 flex flex-wrap gap-3">{!item.active && <button type="button" disabled={!catalog.editingEnabled || !catalog.validationReady || saving} onClick={() => { setPoint({ code: item.code, name: item.name, address: item.address, municipality: item.municipality, timeZone: item.timeZone, appointmentRequired: item.appointmentRequired }); setPointEditId(item.id); }} className="underline disabled:opacity-50">Editar borrador</button>}{!item.active && <button type="button" disabled={!catalog.publishingEnabled || saving} onClick={() => setValidation({ kind: "points", id: item.id, reference: "" })} className="underline disabled:opacity-50">Validar y publicar</button>}{item.active && <button type="button" disabled={!catalog.publishingEnabled || saving} onClick={() => { if (window.confirm("Desactivar este centro? Solo se permitirá si no tiene reservas vigentes.")) void runAction(() => request("POST", `points/${item.id}/deactivate`, {}), "Centro desactivado."); }} className="underline disabled:opacity-50">Desactivar</button>}</div></div>)}{!catalog.points.length && <p className="text-sm">No hay centros registrados.</p>}</div></section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><h2 className="font-display text-2xl">Horarios registrados</h2><div className="mt-3 space-y-2">{catalog.slots.map(item => <div key={item.id} className="border-t border-[hsl(var(--border))] py-3 text-sm"><p>{catalog.points.find(point => point.id === item.pointId)?.name || "Centro no disponible"} · {new Date(item.startsAt).toLocaleString("es-CO")} · {item.remainingCapacity}/{item.capacity} cupos · {item.active ? "Activo" : "Borrador"}</p>{item.active && item.validationReference?.startsWith("https://") && <a href={item.validationReference} target="_blank" rel="noopener noreferrer" className="underline">Ver evidencia de disponibilidad</a>}<div className="mt-2 flex flex-wrap gap-3">{!item.active && <button type="button" disabled={!catalog.editingEnabled || !catalog.validationReady || saving} onClick={() => { setSlot({ pointId: item.pointId, startsAt: localInputDate(item.startsAt), endsAt: localInputDate(item.endsAt), capacity: String(item.capacity) }); setSlotEditId(item.id); }} className="underline disabled:opacity-50">Editar borrador</button>}{!item.active && <button type="button" disabled={!catalog.publishingEnabled || saving} onClick={() => setValidation({ kind: "slots", id: item.id, reference: "" })} className="underline disabled:opacity-50">Validar y publicar</button>}{item.active && <button type="button" disabled={!catalog.publishingEnabled || saving} onClick={() => setCapacityEdit({ id: item.id, capacity: String(item.capacity), reference: "" })} className="underline disabled:opacity-50">Ajustar capacidad</button>}{item.active && <button type="button" disabled={!catalog.publishingEnabled || saving} onClick={() => { if (window.confirm("Desactivar este horario? Solo se permitirá si no tiene reservas vigentes.")) void runAction(() => request("POST", `slots/${item.id}/deactivate`, {}), "Horario desactivado."); }} className="underline disabled:opacity-50">Desactivar</button>}</div></div>)}{!catalog.slots.length && <p className="text-sm">No hay horarios registrados.</p>}</div></section>
      {validation && <form onSubmit={event => { event.preventDefault(); if (!catalog.publishingEnabled) return; void runAction(async () => { await request("POST", `${validation.kind}/${validation.id}/validate`, { validationReference: validation.reference }); setValidation(null); }, "Registro validado y publicado."); }} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="font-display text-xl">Evidencia para publicar</h2><p className="text-sm">La URL HTTPS debe respaldar la ubicación o la franja y capacidad concretas. Comprueba directamente con el operador que acepta entregas de EcoPulse antes de publicar.</p><label className="mt-3 block text-sm font-semibold">URL de la evidencia<input required type="url" minLength={10} maxLength={500} value={validation.reference} onChange={event => setValidation(current => current && ({ ...current, reference: event.target.value }))} className="mt-1 w-full rounded-xl border p-2" /></label><div className="mt-3 flex gap-3"><button disabled={saving || !catalog.publishingEnabled} className="rounded-full bg-[hsl(var(--primary))] px-5 py-2 text-[hsl(var(--primary-foreground))] disabled:opacity-50">Confirmar publicación</button><button type="button" onClick={() => setValidation(null)} className="underline">Cancelar</button></div></form>}
      {capacityEdit && <form onSubmit={event => { event.preventDefault(); if (!catalog.publishingEnabled) return; void runAction(async () => { await request("PATCH", `slots/${capacityEdit.id}/capacity`, { capacity: Number(capacityEdit.capacity), validationReference: capacityEdit.reference }); setCapacityEdit(null); }, "Capacidad actualizada."); }} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="font-display text-xl">Ajustar capacidad validada</h2><label className="mt-3 block text-sm font-semibold">Nueva capacidad<input required min={1} max={1000} step={1} type="number" value={capacityEdit.capacity} onChange={event => setCapacityEdit(current => current && ({ ...current, capacity: event.target.value }))} className="mt-1 w-full rounded-xl border p-2" /></label><label className="mt-3 block text-sm font-semibold">URL de la capacidad confirmada<input required type="url" minLength={10} maxLength={500} value={capacityEdit.reference} onChange={event => setCapacityEdit(current => current && ({ ...current, reference: event.target.value }))} className="mt-1 w-full rounded-xl border p-2" /></label><div className="mt-3 flex gap-3"><button disabled={saving || !catalog.publishingEnabled} className="rounded-full bg-[hsl(var(--primary))] px-5 py-2 text-[hsl(var(--primary-foreground))] disabled:opacity-50">Guardar capacidad</button><button type="button" onClick={() => setCapacityEdit(null)} className="underline">Cancelar</button></div></form>}
    </>}
  </div>;
}
