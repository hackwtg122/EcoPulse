import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { ArrowRight, Gift, ShieldCheck, PackageCheck, Sparkles, Boxes, Clock3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createRewardDraft, downloadRedemption, loadAdminRedemptions, loadAdminRewards, loadRedemptions, loadRewardBalance, loadRewardCapabilities, loadRewards, loadPointMovements, fulfillRedemption, publishRewardDraft, redeemReward, RewardApiError, updateRewardDraft, type PointMovement, type RewardCapabilities, type RewardDraftInput, type RedemptionItem, type RewardItem } from "./reward-api";
import kitImage from "./assets/academic-kit.svg";
import badgeImage from "./assets/academic-badge.svg";
import landscapeImage from "./assets/academic-landscape.svg";
import { canRedeemReward, hasRewardInventory } from "./reward-api";
import { loadAdminFulfillmentHistory, type FulfilledRedemption } from "./reward-api";
import { loadRewardInventoryHistory, restockRewardInventory, validInventoryRestock, type InventoryMovement } from "./reward-api";
import { readRestockIntent, saveRestockIntent, clearRestockIntent, type RestockIntent } from "./reward-inventory-intent";
import { canEditRewardDraft, canRestockReward, recoverRewardDraft } from "./reward-api";
import { loadDigitalRewardAssets, type DigitalRewardAsset, savePhysicalRewardPhoto } from "./reward-api";

const emptyDraft: RewardDraftInput = { title: "", description: "", cost: 1 };
const fulfillmentReferencePattern = /^[A-Za-z0-9_:/.-]{10,120}$/;
const redemptionKeyPattern = /^[A-Za-z0-9_-]{8,128}$/;
function rewardImage(title: string): string {
  if (title === "Kit digital de reciclaje") return kitImage;
  if (title === "Insignia Huella Verde") return badgeImage;
  return landscapeImage;
}

// Only an explicitly fulfilled, server-recognized asset can be downloaded.
function digitalDownload(item: RedemptionItem): { filename: string } | null {
  if (item.fulfillmentStatus !== "fulfilled") return null;
  if (item.digitalAsset === "nature-v1") {
    return { filename: "ecopulse-naturaleza.svg" };
  }
  if (item.digitalAsset === "badge-v1") return { filename: "ecopulse-insignia.svg" };
  if (item.digitalAsset === "guide-v1") return { filename: "ecopulse-guia.pdf" };
  return null;
}

function inventoryLabel(item: RewardItem): string {
  if (item.inventoryRemaining == null) return "Inventario sin documentar";
  return item.inventoryRemaining > 0 ? `${item.inventoryRemaining} disponibles` : "Sin existencias";
}
function availabilityLabel(item: RewardItem): { text: string; tone: string } {
  if (!item.active) return { text: "No publicada", tone: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]" };
  if (item.inventoryRemaining != null && item.inventoryRemaining <= 0) return { text: "Agotada", tone: "bg-amber-100 text-amber-800" };
  if (!hasRewardInventory(item)) return { text: "Inventario sin confirmar", tone: "bg-amber-100 text-amber-800" };
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
  const requestKey = useRef<{ rewardId: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const redemptionStorageKey = (rewardId: string) => `ecopulse:pending-redemption:${userId}:${rewardId}`;
  const pendingRedemptionKey = (rewardId: string) => {
    if (requestKey.current?.rewardId === rewardId) return requestKey.current.key;
    let key: string | null = null;
    try { key = sessionStorage.getItem(redemptionStorageKey(rewardId)); } catch { /* Storage may be unavailable. */ }
    if (!key || !redemptionKeyPattern.test(key)) key = `redeem_${crypto.randomUUID()}`;
    requestKey.current = { rewardId, key };
    try { sessionStorage.setItem(redemptionStorageKey(rewardId), key); } catch { /* Keep the key in memory. */ }
    return key;
  };
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
  const download = async (item: RedemptionItem, filename: string) => {
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const blob = await downloadRedemption(apiUrl, token, item.id, new AbortController().signal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("No se pudo descargar el recurso. Verifica tu sesión e inténtalo de nuevo."); }
  };
  const confirmRedemption = async () => {
    if (!selected || !confirmed || !capabilities?.canRedeem || inFlight.current) return;
    if (requestKey.current?.rewardId !== selected.id && !canRedeemReward(selected, capabilities.canRedeem, balance)) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const key = pendingRedemptionKey(selected.id);
      await redeemReward(apiUrl, token, selected.id, key, new AbortController().signal);
      try { sessionStorage.removeItem(redemptionStorageKey(selected.id)); } catch { /* No credential is stored. */ }
      requestKey.current = null; setSelected(null); setConfirmed(false); setMessage("Canje registrado. Consulta el estado en tu historial."); refresh();
    } catch (cause) {
      setError(cause instanceof RewardApiError && cause.code === "insufficient_points" ? "El saldo ya no cubre este canje." :
        cause instanceof RewardApiError && cause.code === "reward_unavailable" ? "La recompensa ya no está disponible." :
        "No se pudo completar el canje. Reintenta sin cambiar la solicitud; el servidor evita duplicados.");
    } finally { setBusy(false); inFlight.current = false; }
  };
  return <div className="animate-rise space-y-6" data-testid="rewards-catalog">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Catálogo de recompensas</p><h1 className="mt-2 font-display text-4xl text-[hsl(var(--primary))]">Premios con raíz.</h1><p className="mt-2 max-w-xl text-sm text-[hsl(var(--muted-foreground))]">Consulta las recompensas y su disponibilidad. Los escaneos no generan puntos; las entregas verificadas pueden sumar saldo cuando el servicio esté activo.</p><Link href="/deliveries" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))] underline" data-testid="link-rewards-earn">¿Cómo se gana saldo? Solo con entregas verificadas <ArrowRight size={14} /></Link></div>
      <div className="flex items-center gap-3 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 py-4"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Sparkles size={20} /></span><div><p className="text-xs text-[hsl(var(--muted-foreground))]">Saldo actual</p><p className="font-display text-3xl text-[hsl(var(--primary))]" data-testid="rewards-balance">{status === "ready" ? `${balance.toLocaleString("es-CO")} pts` : "…"}</p></div></div>
    </header>
    {status === "loading" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((slot) => <section key={slot} className="h-56 animate-pulse rounded-[2rem] bg-[hsl(var(--muted))] p-6"><span className="text-sm text-[hsl(var(--muted-foreground))]">Cargando recompensa…</span></section>)}</div>}
    {status === "error" && <div role="alert" className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-800" data-testid="rewards-error"><p className="font-semibold">No se pudo cargar el catálogo.</p><p className="mt-1 text-sm">Verifica tu conexión e inténtalo de nuevo.</p><button type="button" onClick={refresh} className="mt-3 underline">Reintentar</button></div>}
    {message && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">{message}</p>}
    {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-900">{error}</p>}
    {status === "ready" && capabilities && <>
       {!capabilities.canRedeem && <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="rewards-policy-notice">Los canjes no están disponibles por ahora. Puedes explorar las recompensas y consultar tu saldo.</p>}
      <section aria-labelledby="reward-catalog-title"><div className="mb-4 flex items-center justify-between"><h2 id="reward-catalog-title" className="font-display text-2xl text-[hsl(var(--primary))]">Recompensas publicadas</h2><button type="button" onClick={refresh} className="inline-flex items-center gap-2 text-sm underline"><Clock3 size={15} />Actualizar</button></div>
          {rewards.length === 0 ? <div role="status" data-testid="rewards-empty"><p className="text-sm text-[hsl(var(--muted-foreground))]">No hay recompensas publicadas con inventario y cumplimiento confirmados. Cuando exista disponibilidad real, aparecerá aquí con su costo en EcoPuntos.</p></div> :
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rewards.map(item => { const availability = availabilityLabel(item); const redeemable = canRedeemReward(item, capabilities.canRedeem, balance); return <article key={item.id} className="group flex flex-col overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[hsl(var(--primary)/.45)] hover:shadow-xl focus-within:shadow-lg" data-testid={`reward-card-${item.id}`}><img src={item.imageUrl || rewardImage(item.title)} alt={item.imageUrl ? "Fotografía de " + item.title : "Ilustración de " + item.title} className="mb-4 h-36 w-full rounded-2xl bg-gradient-to-br from-[hsl(var(--secondary)/.36)] via-[hsl(var(--muted))] to-[hsl(var(--primary)/.12)] p-4 object-contain transition-transform duration-200 group-hover:scale-[1.02]" /><div className="flex items-start justify-between gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Gift size={22} /></span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${availability.tone}`}>{availability.text}</span></div><h3 className="mt-4 font-display text-2xl text-[hsl(var(--primary))]">{item.title}</h3><p className="mt-2 flex-1 text-sm text-[hsl(var(--muted-foreground))]">{item.description}</p><div className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Boxes size={14} />{inventoryLabel(item)}</div><p className="mt-3 font-display text-3xl text-[hsl(var(--primary))]">{item.cost.toLocaleString("es-CO")} <span className="text-base font-semibold">EcoPuntos</span></p><button type="button" disabled={!redeemable} onClick={() => { setSelected(item); setConfirmed(false); }} className="mt-4 min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50" data-testid={`button-redeem-${item.id}`}>{!item.active ? "No disponible" : item.inventoryRemaining != null && item.inventoryRemaining <= 0 ? "Agotada" : !hasRewardInventory(item) ? "Inventario sin confirmar" : balance < item.cost ? "Saldo insuficiente" : !capabilities.canRedeem ? "Canjes desactivados" : "Canjear"}</button></article>; })}</div>}
      </section>
       <section aria-labelledby="movement-history-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><h2 id="movement-history-title" className="font-display text-2xl text-[hsl(var(--primary))]">Mis EcoPuntos</h2>{movements.length === 0 ? <p className="mt-3 text-sm">Todavía no tienes movimientos de EcoPuntos.</p> : <ol className="mt-3 divide-y divide-[hsl(var(--border))]">{movements.map(item => <li key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span>{item.kind === "delivery" ? "Entrega verificada" : item.kind === "redemption" ? "Canje" : "Ajuste"} · {new Date(item.createdAt).toLocaleDateString("es-CO")}</span><strong>{item.delta > 0 ? "+" : ""}{item.delta} pts</strong></li>)}</ol>}</section>
       <section aria-labelledby="redemption-history-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center gap-2"><PackageCheck size={18} className="text-[hsl(var(--primary))]" /><h2 id="redemption-history-title" className="font-display text-2xl text-[hsl(var(--primary))]">Historial de canjes</h2></div>{history.length === 0 ? <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" data-testid="rewards-history-empty">Todavía no tienes canjes registrados. Cuando canjees una recompensa aparecerá aquí con su estado.</p> : <ol className="mt-4 divide-y divide-[hsl(var(--border))]">{history.map(item => { const asset = digitalDownload(item); return <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm" data-testid={`redemption-row-${item.id}`}><span>{item.rewardTitle} · {new Date(item.createdAt).toLocaleDateString("es-CO")}</span><span className="font-semibold">{item.cost} pts · {item.fulfillmentStatus === "fulfilled" ? "Completado" : "Reservado"}{asset && <> · <button type="button" onClick={() => void download(item, asset.filename)} className="underline" data-testid={`download-redemption-${item.id}`}>Descargar recompensa</button></>}</span></li>; })}</ol>}</section>
    </>}
    {selected && <div role="dialog" aria-modal="true" aria-labelledby="redeem-dialog-title" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><div className="w-full max-w-md rounded-[2rem] bg-[hsl(var(--card))] p-6"><h2 id="redeem-dialog-title" className="font-display text-2xl">Confirmar canje</h2><p className="mt-3 text-sm">{selected.title} · {selected.cost.toLocaleString("es-CO")} EcoPuntos. El canje se registrará en tu cuenta.</p><label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirmo este canje.</label><div className="mt-5 flex gap-3"><button type="button" disabled={busy} onClick={() => setSelected(null)} className="underline">Cancelar</button><button type="button" disabled={!confirmed || busy} onClick={() => void confirmRedemption()} className="rounded-full bg-[hsl(var(--primary))] px-5 py-2 text-[hsl(var(--primary-foreground))] disabled:opacity-50">{busy ? "Registrando…" : "Confirmar"}</button></div></div></div>}
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
  const [fulfilled, setFulfilled] = useState<FulfilledRedemption[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequest = useRef<AbortController | null>(null);
  const adminReadSequence = useRef(0);
  const [restockTarget, setRestockTarget] = useState("");
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockEvidence, setRestockEvidence] = useState("");
  const [restockConfirmed, setRestockConfirmed] = useState(false);
  const [restockIntent, setRestockIntent] = useState<RestockIntent | null>(null);
  const restockRequest = useRef<AbortController | null>(null);
  const inventoryRequest = useRef<AbortController | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState("");
  const [inventoryRows, setInventoryRows] = useState<InventoryMovement[]>([]);
  const [inventoryCursor, setInventoryCursor] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [draft, setDraft] = useState<RewardDraftInput>(emptyDraft);
  const [editing, setEditing] = useState<RewardItem | null>(null);
  const [fulfillTarget, setFulfillTarget] = useState<string | null>(null);
  const [fulfillReference, setFulfillReference] = useState("");
  const [publishTarget, setPublishTarget] = useState<RewardItem | null>(null);
  const [publishInventory, setPublishInventory] = useState("");
  const [publishReference, setPublishReference] = useState("");
  const [digitalAssets, setDigitalAssets] = useState<DigitalRewardAsset[]>([]);
  const [publishAsset, setPublishAsset] = useState("");
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [photoTarget, setPhotoTarget] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoSource, setPhotoSource] = useState("");
  const [photoConfirmed, setPhotoConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const draftKey = useRef<string | null>(null);
  const recoveryKeys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!userId || role !== "admin") return;
    const sequence = ++adminReadSequence.current;
    historyRequest.current?.abort(); setHistoryLoading(false); setHistoryError("");
    setStatus("loading"); setError("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const [caps, adminList, redemptions, history, assets] = await Promise.all([
        loadRewardCapabilities(apiUrl, token, signal),
        loadAdminRewards(apiUrl, token, signal),
        loadAdminRedemptions(apiUrl, token, signal),
        loadAdminFulfillmentHistory(apiUrl, token, null, signal),
        loadDigitalRewardAssets(apiUrl, token, signal).catch(() => []),
      ]);
      if (!signal.aborted && sequence === adminReadSequence.current) { setCapabilities(caps); setDrafts(adminList); setAdminRedemptions(redemptions); setFulfilled(history.items); setHistoryCursor(history.nextCursor); setDigitalAssets(assets); setStatus("ready"); }
    } catch { if (!signal.aborted && sequence === adminReadSequence.current) setStatus("error"); }
  }, [apiUrl, getToken, role, userId]);
  useEffect(() => {
    setDrafts([]); setAdminRedemptions([]); setFulfilled([]); setHistoryCursor(null); setPublishTarget(null); setPublishConfirmed(false); setStatus("loading");
    const controller = new AbortController();
    void load(controller.signal);
    return () => { ++adminReadSequence.current; controller.abort(); historyRequest.current?.abort(); };
  }, [load]);
  const refresh = () => void load(new AbortController().signal);
  useEffect(() => {
    const saved = role === "admin" && userId ? readRestockIntent(userId) : null;
    recoveryKeys.current.clear();
    setRestockIntent(saved); setRestockTarget(saved?.rewardId ?? ""); setRestockQuantity(saved ? String(saved.input.quantity) : "");
    setRestockEvidence(saved?.input.evidenceReference ?? ""); setRestockConfirmed(false);
    setInventoryTarget(""); setInventoryRows([]); setInventoryCursor(null); setInventoryError(""); setInventoryLoading(false);
    return () => {
      inventoryRequest.current?.abort(); restockRequest.current?.abort();
      if (restockRequest.current) { restockRequest.current = null; inFlight.current = false; setBusy(false); }
    };
  }, [role, userId]);
  const loadInventoryHistory = async (id: string, cursor: string | null = null) => {
    if (role !== "admin") return;
    inventoryRequest.current?.abort(); const controller = new AbortController(); inventoryRequest.current = controller;
    setInventoryTarget(id); setInventoryLoading(true); setInventoryError("");
    if (!cursor) { setInventoryRows([]); setInventoryCursor(null); }
    try {
      const token = await getToken();
      if (controller.signal.aborted) return;
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const page = await loadRewardInventoryHistory(apiUrl, token, id, cursor, controller.signal);
      if (!controller.signal.aborted) { setInventoryRows(rows => cursor ? [...new Map([...rows, ...page.items].map(row => [row.id, row])).values()] : page.items); setInventoryCursor(page.nextCursor); }
    } catch { if (!controller.signal.aborted) setInventoryError("No se pudo consultar el registro de inventario. Reintenta la lectura; no vuelvas a registrar una reposición ya confirmada."); }
    finally { if (inventoryRequest.current === controller) setInventoryLoading(false); }
  };
  const submitRestock = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId || role !== "admin" || !capabilities?.canRestock || !restockTarget || !restockConfirmed || inFlight.current) return;
    const input = restockIntent?.input ?? { quantity: Number(restockQuantity), evidenceReference: restockEvidence, availabilityConfirmed: true as const };
    if (!validInventoryRestock(input)) { setError("Introduce una cantidad entera positiva y una URL HTTPS pública de evidencia, sin credenciales ni fragmentos."); return; }
    const intent = restockIntent ?? { rewardId: restockTarget, key: `restock_${crypto.randomUUID()}`, input };
    setRestockIntent(intent); saveRestockIntent(userId, intent);
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const controller = new AbortController(); restockRequest.current = controller;
    try {
      const token = await getToken();
      if (controller.signal.aborted) return;
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const result = await restockRewardInventory(apiUrl, token, intent.rewardId, intent.key, intent.input, controller.signal);
      if (controller.signal.aborted) return;
      clearRestockIntent(userId); setRestockIntent(null); setRestockQuantity(""); setRestockEvidence(""); setRestockConfirmed(false);
      setMessage(result.replayed ? "Recuperamos la reposición registrada; no se añadieron unidades otra vez." : "Reposición registrada con su evidencia y administrador responsable. No se modificaron puntos ni canjes.");
      refresh(); await loadInventoryHistory(intent.rewardId);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = cause instanceof RewardApiError ? cause.code : "request_failed";
      const rejected = cause instanceof RewardApiError && ([400, 403, 404].includes(cause.status) || ["reward_not_restockable", "reward_inventory_limit_exceeded", "reward_changed_or_unavailable"].includes(code));
      if (rejected) { clearRestockIntent(userId); setRestockIntent(null); }
      setError(code === "reward_not_restockable" ? "Solo se pueden reponer recompensas documentadas publicadas o agotadas. Un borrador requiere publicación inicial." :
        code === "reward_inventory_limit_exceeded" ? "La reposición superaría 100000 unidades disponibles. Revisa el inventario actual y la cantidad adicional." :
        code === "admin_required" ? "Tu cuenta ya no tiene permisos de administrador." :
        code === "idempotency_key_reused" ? "La clave pertenece a otra reposición. Consulta los movimientos antes de continuar; no se creó otra operación." :
        rejected ? "El servidor rechazó la reposición. Revisa los datos y los permisos antes de enviarla de nuevo." :
        "El resultado no está confirmado. Recupera la misma reposición con su clave original para evitar duplicados.");
    } finally { if (restockRequest.current === controller) { restockRequest.current = null; inFlight.current = false; setBusy(false); } }
  };
  const loadMoreFulfilled = async () => {
    if (!historyCursor || historyLoading || status !== "ready" || role !== "admin" || historyRequest.current && !historyRequest.current.signal.aborted) return;
    const controller = new AbortController(); historyRequest.current = controller;
    setHistoryLoading(true); setHistoryError("");
    try {
      const token = await getToken();
      if (controller.signal.aborted) return;
      if (!token) throw new RewardApiError(401, "missing_session_token");
      const page = await loadAdminFulfillmentHistory(apiUrl, token, historyCursor, controller.signal);
      if (!controller.signal.aborted) {
        setFulfilled(rows => [...new Map([...rows, ...page.items].map(row => [row.id, row])).values()]);
        setHistoryCursor(page.nextCursor);
      }
    } catch { if (!controller.signal.aborted) setHistoryError("No se pudo cargar la siguiente página de cumplimientos. Puedes reintentar."); }
    finally { if (historyRequest.current === controller) { historyRequest.current = null; setHistoryLoading(false); } }
  };
  const updateDraft = (next: RewardDraftInput) => { setDraft(next); draftKey.current = null; setError(""); };
  const recoverDraft = async (item: RewardItem) => {
    if (!userId || !item.draftRecoveryAvailable || !capabilities?.canRecoverDraft || inFlight.current) return;
    if (!window.confirm(`¿Preparar «${item.title}» para edición? Se retirará su estado no operativo y quedará sin inventario ni publicación. El registro original se conserva en auditoría. Solo se permite si no tiene canjes, reposiciones ni validación operativa real.`)) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const storageKey = `ecopulse:reward-recovery:${userId}:${item.id}`;
    let key = recoveryKeys.current.get(item.id);
    if (!key) { try { const stored = sessionStorage.getItem(storageKey); if (stored && /^[A-Za-z0-9_-]{8,128}$/.test(stored)) key = stored; } catch { /* Storage may be blocked. */ } }
    key ??= `recovery_${crypto.randomUUID()}`; recoveryKeys.current.set(item.id, key);
    try { sessionStorage.setItem(storageKey, key); } catch { /* Keep it in memory. */ }
    try {
      const token = await getToken(); if (!token) throw new RewardApiError(401, "missing_session_token");
      const result = await recoverRewardDraft(apiUrl, token, item.id, key, new AbortController().signal);
      recoveryKeys.current.delete(item.id); try { sessionStorage.removeItem(storageKey); } catch { /* No credentials stored. */ }
      setEditing(null); setDraft(emptyDraft); draftKey.current = null;
      setMessage(result.replayed ? "El borrador ya estaba preparado; no se repitió el cambio. Actualiza o edita su contenido." : "Premio preparado para edición, sin publicación ni inventario. El estado anterior se conservó en auditoría. Edita el borrador y publica solo con disponibilidad real.");
      refresh();
    } catch (cause) {
      const code = cause instanceof RewardApiError ? cause.code : "request_failed";
      setError(code === "reward_has_operations" || code === "reward_already_operational" ? "El premio tiene operaciones o validación real: no se puede reiniciar ni alterar su historial." :
        "No pudimos confirmar la preparación. Reintenta la misma acción; se conserva la clave para evitar repetir cambios.");
    } finally { setBusy(false); inFlight.current = false; }
  };
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
  const confirmPublication = async (event: FormEvent) => {
    event.preventDefault();
    if (!publishTarget || !publishConfirmed || !capabilities?.canPublish || inFlight.current) return;
    const inventoryRemaining = Number(publishInventory);
    if (!Number.isSafeInteger(inventoryRemaining) || inventoryRemaining < 1 || inventoryRemaining > 100000) { setError("El inventario debe ser un entero entre 1 y 100000."); return; }
    inFlight.current = true; setBusy(true); setMessage(""); setError("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      await publishRewardDraft(apiUrl, token, publishTarget.id, {
        expected: { title: publishTarget.title, description: publishTarget.description, cost: publishTarget.cost },
        inventoryRemaining, ...(publishAsset ? { digitalAssetKey: publishAsset, availabilityConfirmed: true as const } : { fulfillmentReference: publishReference }),
      }, new AbortController().signal);
      setPublishTarget(null); setPublishConfirmed(false);
      setMessage("Recompensa publicada con inventario y evidencia registrados. No se han otorgado puntos ni realizado canjes.");
      window.dispatchEvent(new Event("ecopulse-operational-resources-changed"));
      refresh();
    } catch (cause) {
      const code = cause instanceof RewardApiError ? cause.code : "request_failed";
      setError(code === "digital_asset_required" ? "Este premio digital debe publicarse seleccionando su archivo real del registro de EcoPulse; no utiliza inventario físico ni una referencia escrita a mano." :
        code === "digital_reward_title_mismatch" ? "El título no corresponde al archivo. Edita el borrador usando el título indicado en el registro de archivos." :
        code === "digital_capacity_confirmation_required" ? "Confirma explícitamente los cupos digitales autorizados." :
        code === "invalid_reward_evidence" ? "Introduce una URL HTTPS pública de evidencia, sin credenciales ni fragmento." :
        code === "reward_publication_disabled" ? "La publicación está desactivada por política/configuración; no se ha aplicado el cambio." :
        code === "reward_already_validated" || code === "reward_changed_or_unavailable" ? "La recompensa cambió o ya fue validada. Actualiza la lista; esta acción no repone inventario." :
        "No pudimos confirmar la publicación. Actualiza la lista antes de reintentar.");
    } finally { inFlight.current = false; setBusy(false); }
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
        code === "digital_asset_mismatch" ? "El archivo no corresponde al premio publicado. Actualiza la lista y usa el archivo vinculado al canje." :
        code === "redemption_state_conflict" ? "El estado del canje cambió. Actualiza la lista." :
        "No se pudo registrar el cumplimiento. Verifica la referencia (10–120 caracteres alfanuméricos).");
    } finally { setBusy(false); inFlight.current = false; }
  };
  const savePhoto = async (event: FormEvent) => {
    event.preventDefault();
    if (!photoTarget || !photoConfirmed || !photoUrl.startsWith("https://") || !photoSource.startsWith("https://") || role !== "admin" || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new RewardApiError(401, "missing_session_token");
      await savePhysicalRewardPhoto(apiUrl, token, photoTarget,
        { imageUrl: photoUrl, sourceUrl: photoSource, photoConfirmed: true }, new AbortController().signal);
      setMessage("Foto real registrada; el artículo se muestra cuando su inventario está validado.");
      setPhotoTarget(""); setPhotoUrl(""); setPhotoSource(""); setPhotoConfirmed(false); refresh();
    } catch {
      setError("No se registró la fotografía. Comprueba que el artículo fue publicado y que la migración de fotografías está activa.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  const restockItem = drafts.find(item => item.id === restockTarget);
  const selectedDigitalAsset = digitalAssets.find(asset => asset.key === publishAsset);
  const restockable = Boolean(restockItem && canRestockReward(restockItem));
  if (role !== "admin") return <p className="rounded-[2rem] border border-[hsl(var(--border))] p-6" role="alert">Esta sección es exclusiva para administradores.</p>;
  return <div className="animate-rise space-y-6" data-testid="rewards-admin-panel">
    <header><p className="text-xs font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Administración</p><h1 className="mt-2 font-display text-4xl text-[hsl(var(--primary))]">Gestión de recompensas</h1><p className="mt-2 max-w-xl text-sm text-[hsl(var(--muted-foreground))]">Gestiona borradores y recompensas documentadas. Publicar no acredita una entrega; el cumplimiento se registra por separado.</p><button type="button" disabled={busy || status === "loading"} onClick={refresh} className="mt-3 min-h-11 underline disabled:opacity-50" data-testid="button-refresh-rewards-admin">Actualizar gestión</button></header>
    {status === "loading" && <p aria-busy="true" className="rounded-2xl bg-[hsl(var(--muted))] p-5">Cargando datos administrativos…</p>}
    {status === "error" && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">No se pudo cargar la gestión. <button type="button" onClick={refresh} className="underline">Reintentar</button></div>}
    {message && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">{message}</p>}
    {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-900">{error}</p>}
    {status === "ready" && capabilities && <>
        <section aria-labelledby="reward-admin-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center gap-2"><ShieldCheck size={18} /><h2 id="reward-admin-title" className="font-display text-2xl text-[hsl(var(--primary))]">Administrar borradores</h2></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Guardar un borrador no lo publica. La publicación exige inventario, evidencia de cumplimiento y política aprobada; no requiere editar PostgreSQL.</p>
        {!capabilities.canManageDrafts && <p className="mt-4 rounded-xl bg-[hsl(var(--muted))] p-4 text-sm">La creación y edición de borradores siguen desactivadas por configuración. No se pueden publicar recompensas ni realizar canjes.</p>}
        <form onSubmit={saveDraft} className="mt-5 grid gap-3"><label className="text-sm">Título<input required maxLength={120} value={draft.title} onChange={event => updateDraft({ ...draft, title: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border p-2" /></label><label className="text-sm">Descripción<textarea required maxLength={500} value={draft.description} onChange={event => updateDraft({ ...draft, description: event.target.value })} className="mt-1 w-full rounded-xl border p-2" /></label><label className="text-sm">Costo provisional en puntos<input required type="number" min={1} max={100000} step={1} value={draft.cost} onChange={event => updateDraft({ ...draft, cost: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border p-2" /></label><div className="flex gap-3"><button disabled={!capabilities.canManageDrafts || busy} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50">{busy ? "Guardando…" : editing ? "Actualizar borrador" : "Guardar borrador"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft(emptyDraft); }} className="underline">Cancelar edición</button>}</div></form>
        {!capabilities.canPublish && <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]" data-testid="reward-publication-disabled">La publicación permanece cerrada. <Link href="/admin?section=settings" className="font-semibold underline">Revisa los requisitos y activa las recompensas en Configuración general.</Link></p>}
        <div className="mt-6 space-y-2">{drafts.length === 0 ? <p className="text-sm">No hay borradores registrados.</p> : drafts.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div><strong>{item.title}</strong><p className="text-xs">{item.operationallyValidated === false && !canEditRewardDraft(item) ? "Requiere validación real · las cantidades heredadas no están disponibles" : item.active ? "Publicado" : item.validationRecorded ? "Agotado o retirado" : "Borrador"} · {item.cost} pts</p>{item.operationallyValidated && <p className="text-xs">{item.digitalAssetKey ? "Cupos digitales" : "Inventario confirmado"}: {item.inventoryRemaining ?? 0}</p>}{item.draftRecoveryAvailable && <p className="mt-1 text-xs">1. Preparar para edición conserva el original en auditoría. 2. Revisa descripción y precio. 3. Selecciona el archivo real y declara los cupos digitales al publicar.</p>}</div>
          <div className="flex flex-wrap gap-3"><button type="button" disabled={!canEditRewardDraft(item) || !capabilities.canManageDrafts || busy} onClick={() => chooseDraft(item)} className="underline disabled:opacity-50">Editar</button>
            <button type="button" disabled={item.active || item.validationRecorded || !capabilities.canPublish || busy} onClick={() => { setPublishTarget(item); setPublishAsset(digitalAssets.find(asset => asset.rewardTitle === item.title)?.key ?? ""); setPublishInventory(""); setPublishReference(""); setPublishConfirmed(false); }} className="underline disabled:opacity-50" data-testid={`button-publish-reward-${item.id}`}>Documentar y publicar</button>
            {item.draftRecoveryAvailable && <button type="button" disabled={!capabilities.canRecoverDraft || busy} onClick={() => void recoverDraft(item)} className="underline disabled:opacity-50" data-testid={`button-recover-reward-${item.id}`}>Preparar para edición</button>}
          </div></article>)}</div>
        {publishTarget && <form onSubmit={confirmPublication} className="mt-4 space-y-3 rounded-xl border p-4" data-testid="reward-publication-form">
          <h3 className="font-semibold">Publicar {publishTarget.title}</h3>
          {!digitalAssets.length && <p role="alert">No se pudo cargar el registro de archivos digitales. Actualiza la gestión para reintentar; no publiques un archivo escribiendo una referencia heredada.</p>}
          <label className="block text-sm">Tipo de recompensa y archivo<select value={publishAsset} disabled={busy} onChange={event => { setPublishAsset(event.target.value); setPublishConfirmed(false); setPublishInventory(""); }} className="mt-1 min-h-11 w-full rounded-xl border p-2" data-testid="select-publish-digital-asset"><option value="">Inventario físico con evidencia externa</option>{digitalAssets.map(asset => <option key={asset.key} value={asset.key} disabled={asset.rewardTitle !== publishTarget.title}>{asset.rewardTitle} · {asset.filename}{asset.rewardTitle !== publishTarget.title ? " · requiere ese título" : ""}</option>)}</select></label>
          {selectedDigitalAsset && <p className="text-sm">Archivo real: {selectedDigitalAsset.filename} · {selectedDigitalAsset.bytes} bytes. El servidor verifica título, tipo y huella del archivo. <Link href="/admin?section=settings" className="underline">Revisar y descargar el archivo</Link>.</p>}
          <label className="block text-sm">{publishAsset ? "Cupos de canje digital autorizados (no inventario físico)" : "Inventario físico confirmado"}<input type="number" required min={1} max={100000} step={1} disabled={busy} value={publishInventory} onChange={event => setPublishInventory(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-2" data-testid="input-publish-inventory" /></label>
          {!publishAsset && <label className="block text-sm">Evidencia pública de cumplimiento (HTTPS)<input type="url" required minLength={10} maxLength={500} value={publishReference} disabled={busy} onChange={event => setPublishReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-2" data-testid="input-publish-evidence" /></label>}
          <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={publishConfirmed} onChange={event => setPublishConfirmed(event.target.checked)} />{publishAsset ? "Autorizo publicar este archivo real con la cantidad de canjes digitales indicada. No representa existencias físicas." : "Confirmo que el inventario y la capacidad de cumplimiento están respaldados por la política aprobada."}</label>
          <div className="flex gap-3"><button type="submit" disabled={busy || !publishConfirmed || !capabilities.canPublish} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-confirm-publish-reward">{busy ? "Publicando…" : "Confirmar publicación"}</button><button type="button" disabled={busy} onClick={() => setPublishTarget(null)} className="underline">Cancelar</button></div>
        </form>}
      </section>
        <section aria-labelledby="admin-fulfillment-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center gap-2"><PackageCheck size={18} /><h2 id="admin-fulfillment-title" className="font-display text-2xl text-[hsl(var(--primary))]">Cumplimiento de canjes</h2></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Para premios digitales, el servidor obtiene el archivo vinculado al publicar. Confirma Habilitar descarga para entregarlo exclusivamente al propietario del canje, sin escribir códigos técnicos. Para premios físicos, registra únicamente una entrega efectivamente realizada.</p>
        {!capabilities.canFulfill && <p className="mt-4 rounded-xl bg-[hsl(var(--muted))] p-4 text-sm">El cumplimiento de canjes está desactivado. <Link href="/admin?section=settings" className="font-semibold underline">Consulta los requisitos y activa los módulos preparados en Configuración general.</Link></p>}
        {capabilities.canFulfill && adminRedemptions.length === 0 && <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">No hay canjes reservados pendientes de cumplimiento.</p>}
        {capabilities.canFulfill && adminRedemptions.length > 0 && <div className="mt-4 space-y-3">{adminRedemptions.map(item => <article key={item.id} className="rounded-xl border border-[hsl(var(--border))] p-4" data-testid={`admin-redemption-${item.id}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{item.rewardTitle}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{item.cost} pts · {new Date(item.createdAt).toLocaleDateString("es-CO")} · {item.fulfillmentStatus === "fulfilled" ? "Entregado" : "Reservado"}</p></div>{item.fulfillmentStatus === "reserved" && fulfillTarget !== item.id && <button type="button" disabled={busy || !capabilities.canFulfill} onClick={() => { setFulfillTarget(item.id); setFulfillReference(item.digitalFulfillmentReference ?? ""); }} className="underline disabled:opacity-50">{item.digitalFulfillmentReference ? "Habilitar descarga" : "Registrar entrega física"}</button>}</div>
          {fulfillTarget === item.id && <form onSubmit={event => { event.preventDefault(); void confirmFulfill(item.id); }} className="mt-3 space-y-2 rounded-xl bg-[hsl(var(--muted)/.65)] p-4">
            {item.digitalFulfillmentReference ? <p className="text-sm" data-testid="digital-fulfillment-confirmation">Se entregará el archivo real vinculado a {item.rewardTitle}. La descarga quedará disponible en el historial del participante; no se registra una entrega física.</p> : <label className="block text-sm font-semibold">Referencia de la entrega física realizada<input required minLength={10} maxLength={120} pattern="[A-Za-z0-9_:/.\\-]{10,120}" value={fulfillReference} disabled={busy} onChange={event => setFulfillReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm" data-testid="input-fulfill-reference" /></label>}
            <div className="flex gap-3"><button type="submit" disabled={busy || !fulfillmentReferencePattern.test(fulfillReference.trim())} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-confirm-fulfill">{busy ? "Guardando…" : item.digitalFulfillmentReference ? "Confirmar descarga digital" : "Confirmar entrega física"}</button><button type="button" disabled={busy} onClick={() => { setFulfillTarget(null); setFulfillReference(""); }} className="underline">Cancelar</button></div></form>}
        </article>)}</div>}
      </section>
      <section aria-labelledby="physical-photo-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="physical-reward-photos">
        <h2 id="physical-photo-title" className="font-display text-2xl">Fotografías de recompensas físicas</h2>
        <p className="mt-2 text-sm">Para un premio físico, confirma primero sus existencias y publica el borrador. Después registra aquí una fotografía del artículo específico y su fuente autorizada. La foto no crea unidades ni canjes.</p>
        <form onSubmit={savePhoto} className="mt-4 space-y-3">
          <label className="block text-sm">Premio físico<select required value={photoTarget} disabled={busy} onChange={event => { setPhotoTarget(event.target.value); setPhotoConfirmed(false); }} className="mt-1 min-h-11 w-full rounded-xl border p-2"><option value="">Selecciona premio publicado</option>{drafts.filter(item => item.active && item.operationallyValidated && !item.digitalAssetKey).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="block text-sm">URL HTTPS de fotografía real<input required type="url" maxLength={800} value={photoUrl} disabled={busy} onChange={event => { setPhotoUrl(event.target.value); setPhotoConfirmed(false); }} className="mt-1 min-h-11 w-full rounded-xl border p-2"/></label>
          <label className="block text-sm">Fuente y permiso de uso (URL HTTPS)<input required type="url" maxLength={800} value={photoSource} disabled={busy} onChange={event => { setPhotoSource(event.target.value); setPhotoConfirmed(false); }} className="mt-1 min-h-11 w-full rounded-xl border p-2"/></label>
          {photoUrl.startsWith("https://") && <img src={photoUrl} alt="Vista previa de la fotografía del producto" referrerPolicy="no-referrer" className="h-36 w-48 rounded-xl border object-contain" />}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={photoConfirmed} disabled={busy} onChange={event => setPhotoConfirmed(event.target.checked)} />Confirmo que la foto representa el producto y que tengo permiso para publicarla.</label>
          <button disabled={busy || !photoTarget || !photoConfirmed} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50">Registrar foto</button>
        </form>
      </section>
      <section aria-labelledby="inventory-management-title" className="space-y-4 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="admin-reward-inventory">
        <h2 id="inventory-management-title" className="font-display text-2xl">Reposición de inventario real</h2>
        <p className="text-sm">Añade únicamente unidades adicionales cuya disponibilidad esté autorizada y documentada. Una recompensa agotada se vuelve a publicar con estas unidades; no se cambian precios, canjes, puntos ni cumplimientos previos.</p>
        {!capabilities.canRestock && <p role="status" data-testid="reward-restock-disabled">La reposición requiere el registro de inventario, permisos administrativos y la política de publicación habilitada.</p>}
        <label className="block text-sm">Recompensa<select value={restockTarget} disabled={busy || Boolean(restockIntent)} onChange={event => { setRestockTarget(event.target.value); setRestockQuantity(""); setRestockEvidence(""); setRestockConfirmed(false); }} className="mt-1 min-h-11 w-full rounded-xl border p-2" data-testid="select-restock-reward"><option value="">Selecciona una recompensa registrada</option>{drafts.map(item => <option key={item.id} value={item.id}>{item.title} · {item.operationallyValidated !== true ? "sin disponibilidad validada" : inventoryLabel(item)}</option>)}{restockIntent && !restockItem && <option value={restockIntent.rewardId}>Reposición pendiente · {restockIntent.rewardId}</option>}</select></label>
        {restockTarget && <button type="button" disabled={inventoryLoading || busy} onClick={() => void loadInventoryHistory(restockTarget)} className="min-h-11 underline" data-testid="button-inventory-history">Consultar movimientos de esta recompensa</button>}
        {restockTarget && capabilities.canRestock && <form onSubmit={submitRestock} className="space-y-3 rounded-xl border p-4" data-testid="reward-restock-form">
          {!restockIntent && !restockable && <p role="status">Este registro no admite reposición: publica primero su inventario inicial y evidencia, o selecciona una recompensa publicada o agotada.</p>}
          {restockIntent && <p role="status" data-testid="restock-pending-notice">Hay una reposición sin confirmar. Se conservan cantidad, evidencia y clave originales: recupérala antes de iniciar otra.</p>}
          <fieldset disabled={busy || Boolean(restockIntent) || !restockable} className="space-y-3">
            <label className="block text-sm">Cantidad adicional (no inventario total)<input type="number" required min={1} max={100000} step={1} value={restockQuantity} onChange={event => setRestockQuantity(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-2" data-testid="input-restock-quantity" /></label>
            <label className="block text-sm">Evidencia autorizada de disponibilidad (HTTPS)<input type="url" required minLength={10} maxLength={500} value={restockEvidence} onChange={event => setRestockEvidence(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-2" data-testid="input-restock-evidence" /></label>
          </fieldset>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={restockConfirmed} disabled={busy} onChange={event => setRestockConfirmed(event.target.checked)} data-testid="checkbox-restock-confirmed" />Confirmo que estas unidades existen y su disponibilidad está autorizada y respaldada por la evidencia indicada. La operación quedará registrada con mi cuenta.</label>
          <button type="submit" disabled={busy || !restockConfirmed || (!restockIntent && !restockable)} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-confirm-restock">{busy ? "Registrando…" : restockIntent ? "Recuperar la misma reposición" : "Confirmar reposición real"}</button>
        </form>}
        {inventoryTarget && <div data-testid="reward-inventory-history"><h3 className="font-semibold">Movimientos de {drafts.find(item => item.id === inventoryTarget)?.title ?? inventoryTarget}</h3>
          {inventoryLoading && <p role="status">Consultando el registro de PostgreSQL…</p>}
          {inventoryError && <p role="alert">{inventoryError} <button type="button" onClick={() => void loadInventoryHistory(inventoryTarget, inventoryCursor)} className="underline">Reintentar lectura</button></p>}
          {!inventoryLoading && !inventoryError && inventoryRows.length === 0 && <p>No hay reposiciones registradas para esta recompensa. El inventario inicial se documenta en su publicación.</p>}
          <ol className="divide-y">{inventoryRows.map(item => <li key={item.id} className="space-y-1 py-3 text-sm"><p>+{item.quantity} unidades · {item.inventoryBefore} → {item.inventoryAfter} disponibles en ese momento</p><p>{new Date(item.createdAt).toLocaleString("es-CO")} · Administrador: <code>{item.administratorId}</code></p><a href={item.evidenceReference} target="_blank" rel="noopener noreferrer" className="break-all underline">{item.evidenceReference}</a></li>)}</ol>
          {inventoryCursor && <button type="button" disabled={inventoryLoading || busy} onClick={() => void loadInventoryHistory(inventoryTarget, inventoryCursor)} className="min-h-11 underline" data-testid="button-more-inventory">Cargar más movimientos</button>}
        </div>}
      </section>
      <section aria-labelledby="fulfilled-history-title" className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="admin-fulfillment-history">
        <h2 id="fulfilled-history-title" className="font-display text-2xl">Historial de canjes cumplidos</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Fecha y referencia de entrega registradas en PostgreSQL. Consultar el historial no descuenta puntos ni inventario.</p>
        {fulfilled.length === 0 ? <p className="mt-4 text-sm" data-testid="admin-fulfillment-history-empty">No hay cumplimientos registrados.</p> : <ol className="mt-4 divide-y divide-[hsl(var(--border))]">{fulfilled.map(item => <li key={item.id} className="space-y-1 py-3 text-sm" data-testid={`fulfilled-redemption-${item.id}`}><p className="font-semibold">{item.rewardTitle} · {item.cost} EcoPuntos</p><p>Canje: <code>{item.id}</code></p><p>Entregado: {new Date(item.fulfilledAt).toLocaleString("es-CO")}</p><p className="break-all">Referencia: <code>{item.fulfillmentReference}</code></p></li>)}</ol>}
        {historyError && <p role="alert" className="mt-3 text-sm text-red-800">{historyError}</p>}
        {historyCursor && <button type="button" onClick={() => void loadMoreFulfilled()} disabled={historyLoading || busy} className="mt-4 min-h-11 underline disabled:opacity-50" data-testid="button-more-fulfillments">{historyLoading ? "Cargando…" : "Cargar más cumplimientos"}</button>}
      </section>
    </>}
  </div>;
}
