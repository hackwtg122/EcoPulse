import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { ArrowRight, Gift, ShieldCheck, PackageCheck, Sparkles, Boxes, Clock3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createRewardDraft, loadAdminRedemptions, loadAdminRewards, loadRedemptions, loadRewardBalance, loadRewardCapabilities, loadRewards, loadPointMovements, fulfillRedemption, redeemReward, RewardApiError, updateRewardDraft, type PointMovement, type RewardCapabilities, type RewardDraftInput, type RedemptionItem, type RewardItem } from "./reward-api";
import kitImage from "./assets/academic-kit.svg";
import badgeImage from "./assets/academic-badge.svg";
import landscapeImage from "./assets/academic-landscape.svg";

const emptyDraft: RewardDraftInput = { title: "", description: "", cost: 1 };
const fulfillmentReferencePattern = /^[A-Za-z0-9_:/.-]{10,120}$/;
const academicShowcase = [
  { title: "Kit digital de reciclaje", description: "Guía descargable para el ejercicio universitario.", cost: 20, image: kitImage },
  { title: "Insignia Huella Verde", description: "Reconocimiento virtual en la simulación.", cost: 40, image: badgeImage },
  { title: "Fondo virtual de naturaleza", description: "Ilustración digital académica.", cost: 80, image: landscapeImage },
] as const;

function rewardImage(title: string): string {
  return academicShowcase.find(item => item.title === title)?.image ?? landscapeImage;
}

function inventoryLabel(item: RewardItem): string {
  if (item.inventoryRemaining == null) return "Inventario sin documentar";
  return item.inventoryRemaining > 0 ? `${item.inventoryRemaining} disponibles` : "Sin existencias";
}
function availabilityLabel(item: RewardItem): { text: string; tone: string } {
  if (!item.active) return { text: "No publicada", tone: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]" };
  if (item.inventoryRemaining != null && item.inventoryRemaining <= 0) return { text: "Agotada", tone: "bg-amber-100 text-amber-800" };
  return { text: "Disponible", tone: "bg-emerald-100 text-emerald-800" };
}

/** User-facing reward catalog: browse published rewards, check the balance and
 * consult redemption history. Administration lives in RewardsAdminPanel. */
export function RewardsPanel({ apiUrl }: { apiUrl: string }) {
  const { getToken, userId } = useAuth();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [history, setHistory] = useState<RedemptionItem[]>([]);
  const [movements, setMovements] = useState<PointMovement[]>([]);
  const [balance, setBalance] = useState(0);
  const [capabilities, setCapabilities] = useState<RewardCapabilities | null>(null);
  const [selected, setSelected] = useState<RewardItem | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!userId) return;
    setStatus("loading"); setError("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
       const [catalog, redemptions, currentBalance, caps, pointHistory] = await Promise.all([
         loadRewards(apiUrl, token, signal), loadRedemptions(apiUrl, token, signal),
         loadRewardBalance(apiUrl, token, signal), loadRewardCapabilities(apiUrl, token, signal),
         loadPointMovements(apiUrl, token, signal),
       ]);
       if (!signal.aborted) { setRewards(catalog); setHistory(redemptions); setMovements(pointHistory); setBalance(currentBalance); setCapabilities(caps); setStatus("ready"); }
    } catch { if (!signal.aborted) setStatus("error"); }
  }, [apiUrl, getToken, userId]);
  useEffect(() => {
     setRewards([]); setHistory([]); setMovements([]); setBalance(0); setSelected(null); setConfirmed(false);
     requestKey.current = null; setStatus("loading");
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const refresh = () => void load(new AbortController().signal);
  const confirmRedemption = async () => {
    if (!selected || !confirmed || !capabilities?.canRedeem || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const key = requestKey.current ?? `redeem_${crypto.randomUUID()}`;
      requestKey.current = key;
      await redeemReward(apiUrl, token, selected.id, key, new AbortController().signal);
      requestKey.current = null; setSelected(null); setConfirmed(false); setMessage("Canje registrado. Consulta el estado en tu historial."); refresh();
    } catch (cause) {
      setError(cause instanceof RewardApiError && cause.code === "insufficient_points" ? "El saldo ya no cubre este canje." :
        cause instanceof RewardApiError && cause.code === "reward_unavailable" ? "La recompensa ya no está disponible." :
        "No se pudo completar el canje. Reintenta sin cambiar la solicitud; el servidor evita duplicados.");
    } finally { setBusy(false); inFlight.current = false; }
  };
  return <div className="animate-rise space-y-6" data-testid="rewards-catalog">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Catálogo de recompensas</p><h1 className="mt-2 font-display text-4xl text-[hsl(var(--primary))]">Premios con raíz.</h1><p className="mt-2 max-w-xl text-sm text-[hsl(var(--muted-foreground))]">Recompensas publicadas con inventario documentado. Los escaneos no generan puntos; solo las entregas verificadas pueden sumar saldo cuando la política esté aprobada.</p><Link href="/deliveries" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))] underline" data-testid="link-rewards-earn">¿Cómo se gana saldo? Solo con entregas verificadas <ArrowRight size={14} /></Link></div>
      <div className="flex items-center gap-3 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 py-4"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Sparkles size={20} /></span><div><p className="text-xs text-[hsl(var(--muted-foreground))]">Saldo actual</p><p className="font-display text-3xl text-[hsl(var(--primary))]" data-testid="rewards-balance">{status === "ready" ? `${balance.toLocaleString("es-CO")} pts` : "…"}</p></div></div>
    </header>
    {status === "loading" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((slot) => <section key={slot} className="h-56 animate-pulse rounded-[2rem] bg-[hsl(var(--muted))] p-6"><span className="text-sm text-[hsl(var(--muted-foreground))]">Cargando recompensa…</span></section>)}</div>}
    {status === "error" && <div role="alert" className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-800" data-testid="rewards-error"><p className="font-semibold">No se pudo cargar el catálogo.</p><p className="mt-1 text-sm">Verifica tu conexión e inténtalo de nuevo.</p><button type="button" onClick={refresh} className="mt-3 underline">Reintentar</button></div>}
    {message && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">{message}</p>}
    {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-900">{error}</p>}
    {status === "ready" && capabilities && <>
       {!capabilities.canRedeem && <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="rewards-policy-notice">Los canjes no están disponibles por ahora. Puedes explorar las recompensas y consultar tu saldo.</p>}
      <section aria-labelledby="reward-catalog-title"><div className="mb-4 flex items-center justify-between"><h2 id="reward-catalog-title" className="font-display text-2xl text-[hsl(var(--primary))]">Recompensas publicadas</h2><button type="button" onClick={refresh} className="inline-flex items-center gap-2 text-sm underline"><Clock3 size={15} />Actualizar</button></div>
         {rewards.length === 0 ? <div role="status" data-testid="rewards-empty"><p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Explora estas recompensas. El canje se mostrará cuando estén disponibles.</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{academicShowcase.map(item => <article key={item.title} className="overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><img src={item.image} alt={`Ilustración de ${item.title}`} className="h-36 w-full bg-[hsl(var(--secondary)/.24)] object-contain" /><div className="p-5"><span className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Ilustración académica</span><h3 className="mt-2 font-display text-2xl text-[hsl(var(--primary))]">{item.title}</h3><p className="mt-2 text-sm">{item.description}</p><p className="mt-4 font-semibold">{item.cost} EcoPuntos propuestos</p><button disabled className="mt-4 min-h-11 w-full rounded-full bg-[hsl(var(--muted))] text-sm font-semibold">Canje aún no disponible</button></div></article>)}</div></div> :
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rewards.map(item => { const availability = availabilityLabel(item); const redeemable = capabilities.canRedeem && item.active && (item.inventoryRemaining == null || item.inventoryRemaining > 0) && balance >= item.cost; return <article key={item.id} className="flex flex-col rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid={`reward-card-${item.id}`}><img src={rewardImage(item.title)} alt={"Ilustracion de " + item.title} className="mb-4 h-32 w-full rounded-xl bg-[hsl(var(--secondary)/.24)] object-contain" /><div className="flex items-start justify-between gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Gift size={22} /></span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${availability.tone}`}>{availability.text}</span></div><h3 className="mt-4 font-display text-2xl text-[hsl(var(--primary))]">{item.title}</h3><p className="mt-2 flex-1 text-sm text-[hsl(var(--muted-foreground))]">{item.description}</p><div className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Boxes size={14} />{inventoryLabel(item)}</div><p className="mt-3 font-display text-3xl text-[hsl(var(--primary))]">{item.cost.toLocaleString("es-CO")} <span className="text-base font-semibold">EcoPuntos</span></p><button type="button" disabled={!redeemable} onClick={() => { requestKey.current = null; setSelected(item); setConfirmed(false); }} className="mt-4 min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50" data-testid={`button-redeem-${item.id}`}>{!item.active ? "No disponible" : item.inventoryRemaining != null && item.inventoryRemaining <= 0 ? "Agotada" : balance < item.cost ? "Saldo insuficiente" : !capabilities.canRedeem ? "Canjes desactivados" : "Canjear"}</button></article>; })}</div>}
      </section>
       <section aria-labelledby="movement-history-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><h2 id="movement-history-title" className="font-display text-2xl text-[hsl(var(--primary))]">Mis EcoPuntos</h2>{movements.length === 0 ? <p className="mt-3 text-sm">Todavía no tienes movimientos de EcoPuntos.</p> : <ol className="mt-3 divide-y divide-[hsl(var(--border))]">{movements.map(item => <li key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span>{item.kind === "delivery" ? "Entrega verificada" : item.kind === "redemption" ? "Canje" : "Ajuste"} · {new Date(item.createdAt).toLocaleDateString("es-CO")}</span><strong>{item.delta > 0 ? "+" : ""}{item.delta} pts</strong></li>)}</ol>}</section>
       <section aria-labelledby="redemption-history-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center gap-2"><PackageCheck size={18} className="text-[hsl(var(--primary))]" /><h2 id="redemption-history-title" className="font-display text-2xl text-[hsl(var(--primary))]">Historial de canjes</h2></div>{history.length === 0 ? <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" data-testid="rewards-history-empty">Todavía no tienes canjes registrados. Cuando canjees una recompensa aparecerá aquí con su estado.</p> : <ol className="mt-4 divide-y divide-[hsl(var(--border))]">{history.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm" data-testid={`redemption-row-${item.id}`}><span>{item.rewardTitle} · {new Date(item.createdAt).toLocaleDateString("es-CO")}</span><span className="font-semibold">{item.cost} pts · {item.fulfillmentStatus === "fulfilled" ? "Completado" : "Reservado"}</span></li>)}</ol>}</section>
    </>}
    {selected && <div role="dialog" aria-modal="true" aria-labelledby="redeem-dialog-title" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><div className="w-full max-w-md rounded-[2rem] bg-[hsl(var(--card))] p-6"><h2 id="redeem-dialog-title" className="font-display text-2xl">Confirmar canje</h2><p className="mt-3 text-sm">{selected.title} · {selected.cost.toLocaleString("es-CO")} EcoPuntos. El canje se registrará en tu cuenta.</p><label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirmo este canje.</label><div className="mt-5 flex gap-3"><button type="button" onClick={() => { setSelected(null); requestKey.current = null; }} className="underline">Cancelar</button><button type="button" disabled={!confirmed || busy} onClick={() => void confirmRedemption()} className="rounded-full bg-[hsl(var(--primary))] px-5 py-2 text-[hsl(var(--primary-foreground))] disabled:opacity-50">{busy ? "Registrando…" : "Confirmar"}</button></div></div></div>}
  </div>;
}

/** Administrative management: reward drafts and physical fulfillment of
 * redemptions. Kept out of the user catalog on purpose. */
export function RewardsAdminPanel({ apiUrl, role }: { apiUrl: string; role: string }) {
  const { getToken, userId } = useAuth();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [capabilities, setCapabilities] = useState<RewardCapabilities | null>(null);
  const [drafts, setDrafts] = useState<RewardItem[]>([]);
  const [adminRedemptions, setAdminRedemptions] = useState<RedemptionItem[]>([]);
  const [draft, setDraft] = useState<RewardDraftInput>(emptyDraft);
  const [editing, setEditing] = useState<RewardItem | null>(null);
  const [fulfillTarget, setFulfillTarget] = useState<string | null>(null);
  const [fulfillReference, setFulfillReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const draftKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!userId || role !== "admin") return;
    setStatus("loading"); setError("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const [caps, adminList, redemptions] = await Promise.all([
        loadRewardCapabilities(apiUrl, token, signal),
        loadAdminRewards(apiUrl, token, signal),
        loadAdminRedemptions(apiUrl, token, signal),
      ]);
      if (!signal.aborted) { setCapabilities(caps); setDrafts(adminList); setAdminRedemptions(redemptions); setStatus("ready"); }
    } catch { if (!signal.aborted) setStatus("error"); }
  }, [apiUrl, getToken, role, userId]);
  useEffect(() => {
    setDrafts([]); setAdminRedemptions([]); setStatus("loading");
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const refresh = () => void load(new AbortController().signal);
  const updateDraft = (next: RewardDraftInput) => { setDraft(next); draftKey.current = null; setError(""); };
  const chooseDraft = (item: RewardItem) => { setEditing(item); updateDraft({ title: item.title, description: item.description, cost: item.cost }); };
  const saveDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!capabilities?.canManageDrafts || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      if (editing) await updateRewardDraft(apiUrl, token, editing.id,
        { title: editing.title, description: editing.description, cost: editing.cost }, draft, new AbortController().signal);
      else {
        const key = draftKey.current ?? `reward_${crypto.randomUUID()}`;
        draftKey.current = key;
        await createRewardDraft(apiUrl, token, draft, key, new AbortController().signal);
      }
      draftKey.current = null; setEditing(null); setDraft(emptyDraft); setMessage("Borrador guardado. No está publicado ni disponible para canje."); refresh();
    } catch (cause) {
      setError(cause instanceof RewardApiError && cause.status === 409 ? "El borrador cambió. Actualiza la lista antes de editarlo." : "No se pudo guardar el borrador. Puedes reintentar la misma operación.");
    } finally { setBusy(false); inFlight.current = false; }
  };
  const confirmFulfill = async (redemptionId: string) => {
    if (!fulfillTarget || !fulfillReference.trim() || !fulfillmentReferencePattern.test(fulfillReference.trim()) || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      await fulfillRedemption(apiUrl, token, redemptionId, fulfillReference.trim(), new AbortController().signal);
      setFulfillTarget(null); setFulfillReference(""); setMessage("Cumplimiento registrado. La referencia quedó asociada a este canje."); refresh();
    } catch (cause) {
      const code = cause instanceof RewardApiError ? cause.code : "request_failed";
      setError(code === "already_fulfilled" ? "Este canje ya fue cumplido con otra referencia." :
        code === "redemption_state_conflict" ? "El estado del canje cambió. Actualiza la lista." :
        "No se pudo registrar el cumplimiento. Verifica la referencia (10–120 caracteres alfanuméricos).");
    } finally { setBusy(false); inFlight.current = false; }
  };
  if (role !== "admin") return <p className="rounded-[2rem] border border-[hsl(var(--border))] p-6" role="alert">Esta sección es exclusiva para administradores.</p>;
  return <div className="animate-rise space-y-6" data-testid="rewards-admin-panel">
    <header><p className="text-xs font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Administración</p><h1 className="mt-2 font-display text-4xl text-[hsl(var(--primary))]">Gestión de recompensas</h1><p className="mt-2 max-w-xl text-sm text-[hsl(var(--muted-foreground))]">Gestiona recompensas de la simulación académica y registra su cumplimiento virtual; no implica compromisos comerciales.</p></header>
    {status === "loading" && <p aria-busy="true" className="rounded-2xl bg-[hsl(var(--muted))] p-5">Cargando datos administrativos…</p>}
    {status === "error" && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">No se pudo cargar la gestión. <button type="button" onClick={refresh} className="underline">Reintentar</button></div>}
    {message && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">{message}</p>}
    {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-900">{error}</p>}
    {status === "ready" && capabilities && <>
       <section aria-labelledby="reward-admin-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center gap-2"><ShieldCheck size={18} /><h2 id="reward-admin-title" className="font-display text-2xl text-[hsl(var(--primary))]">Administrar borradores</h2></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Guardar un borrador no lo publica. Su inventario académico se configura en PostgreSQL.</p>
        {!capabilities.canManageDrafts && <p className="mt-4 rounded-xl bg-[hsl(var(--muted))] p-4 text-sm">La creación y edición de borradores siguen desactivadas por configuración. No se pueden publicar recompensas ni realizar canjes.</p>}
        <form onSubmit={saveDraft} className="mt-5 grid gap-3"><label className="text-sm">Título<input required maxLength={120} value={draft.title} onChange={event => updateDraft({ ...draft, title: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border p-2" /></label><label className="text-sm">Descripción<textarea required maxLength={500} value={draft.description} onChange={event => updateDraft({ ...draft, description: event.target.value })} className="mt-1 w-full rounded-xl border p-2" /></label><label className="text-sm">Costo provisional en puntos<input required type="number" min={1} max={100000} step={1} value={draft.cost} onChange={event => updateDraft({ ...draft, cost: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border p-2" /></label><div className="flex gap-3"><button disabled={!capabilities.canManageDrafts || busy} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50">{busy ? "Guardando…" : editing ? "Actualizar borrador" : "Guardar borrador"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft(emptyDraft); }} className="underline">Cancelar edición</button>}</div></form>
        <div className="mt-6 space-y-2">{drafts.length === 0 ? <p className="text-sm">No hay borradores registrados.</p> : drafts.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><strong>{item.title}</strong><p className="text-xs">{item.active ? "Publicado" : "Borrador"} · {item.cost} pts · Inventario: {item.inventoryRemaining == null ? "sin documentar" : item.inventoryRemaining} · Validación: {item.validationRecorded ? "registrada" : "pendiente"} · Entrega: {item.fulfillmentDocumented ? "documentada" : "pendiente"}</p></div><button type="button" disabled={item.active || !capabilities.canManageDrafts} onClick={() => chooseDraft(item)} className="underline disabled:opacity-50">Editar</button></article>)}</div>
      </section>
       <section aria-labelledby="admin-fulfillment-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center gap-2"><PackageCheck size={18} /><h2 id="admin-fulfillment-title" className="font-display text-2xl text-[hsl(var(--primary))]">Cumplimiento de canjes</h2></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Registra el cumplimiento virtual de canjes académicos con una referencia de auditoría.</p>
        {!capabilities.canFulfill && <p className="mt-4 rounded-xl bg-[hsl(var(--muted))] p-4 text-sm">El cumplimiento de canjes está desactivado por configuración. Activa <code>PILOT_REWARD_FULFILLMENT_ENABLED</code> y <code>PILOT_REWARDS_ENABLED</code>, y define <code>REWARD_POLICY_REFERENCE</code>.</p>}
        {capabilities.canFulfill && adminRedemptions.length === 0 && <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">No hay canjes reservados pendientes de cumplimiento.</p>}
        {capabilities.canFulfill && adminRedemptions.length > 0 && <div className="mt-4 space-y-3">{adminRedemptions.map(item => <article key={item.id} className="rounded-xl border border-[hsl(var(--border))] p-4" data-testid={`admin-redemption-${item.id}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{item.rewardTitle}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{item.cost} pts · {new Date(item.createdAt).toLocaleDateString("es-CO")} · {item.fulfillmentStatus === "fulfilled" ? "Entregado" : "Reservado"}</p></div>{item.fulfillmentStatus === "reserved" && fulfillTarget !== item.id && <button type="button" disabled={busy || !capabilities.canFulfill} onClick={() => { setFulfillTarget(item.id); setFulfillReference(""); }} className="underline disabled:opacity-50">Registrar entrega</button>}</div>
          {fulfillTarget === item.id && <form onSubmit={event => { event.preventDefault(); void confirmFulfill(item.id); }} className="mt-3 space-y-2 rounded-xl bg-[hsl(var(--muted)/.65)] p-4"><label className="block text-sm font-semibold">Referencia de cumplimiento<input required minLength={10} maxLength={120} pattern="[A-Za-z0-9_:/.\\-]{10,120}" value={fulfillReference} onChange={event => setFulfillReference(event.target.value)} placeholder="Ej: REC-2026-001-A" className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm" data-testid="input-fulfill-reference" /></label><div className="flex gap-3"><button type="submit" disabled={busy || !fulfillmentReferencePattern.test(fulfillReference.trim())} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-confirm-fulfill">{busy ? "Guardando…" : "Confirmar entrega"}</button><button type="button" onClick={() => { setFulfillTarget(null); setFulfillReference(""); }} className="underline">Cancelar</button></div></form>}
        </article>)}</div>}
      </section>
    </>}
  </div>;
}
