import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";

const apiUrl = import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001";

type Center = { id: string; active: boolean };
type Catalog = {
  points: Center[];
  editingEnabled: boolean;
  publishingEnabled: boolean;
};
type DeliveryOptions = { enabled: boolean; points: Array<{ id: string }> };
type PublishedReward = { id: string };
type RewardCapabilities = {
  canRedeem: boolean;
  canManageDrafts: boolean;
  canPublish: boolean;
};
type VerificationCapabilities = { receiptEnabled: boolean; decisionEnabled: boolean; pointsEnabled: boolean };
type Snapshot = {
  activeCenters: number;
  availableDestinations: number;
  receiptEnabled: boolean;
  verificationEnabled: boolean;
  pointsEnabled: boolean;
  publishedRewards: number;
  catalogEditing: boolean;
  catalogPublication: boolean;
  rewardEditing: boolean;
  rewardPublication: boolean;
  redemptionsEnabled: boolean;
};

async function readPrivate<T>(path: string, token: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl + "/api/pilot/" + path, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("operational_status_unavailable");
  return await response.json() as T;
}

export function OperationalReadinessPanel() {
  const { getToken, userId } = useAuth();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setStatus("loading");
    if (!userId) return () => controller.abort();

    void (async () => {
      try {
        const token = await getToken();
        if (!token || controller.signal.aborted) throw new Error("session_required");
        const [catalog, options, rewards, capabilities, verification] = await Promise.all([
          readPrivate<Catalog>("admin/catalog", token, controller.signal),
          readPrivate<DeliveryOptions>("delivery-options", token, controller.signal),
          readPrivate<PublishedReward[]>("rewards", token, controller.signal),
          readPrivate<RewardCapabilities>("rewards/capabilities", token, controller.signal),
          readPrivate<VerificationCapabilities>("verifier/capabilities", token, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setSnapshot({
          activeCenters: catalog.points.filter(point => point.active).length,
          availableDestinations: options.enabled ? options.points.length : 0,
          receiptEnabled: verification.receiptEnabled,
          verificationEnabled: verification.decisionEnabled,
          pointsEnabled: verification.pointsEnabled,
          publishedRewards: rewards.length,
          catalogEditing: catalog.editingEnabled,
          catalogPublication: catalog.publishingEnabled,
          rewardEditing: capabilities.canManageDrafts,
          rewardPublication: capabilities.canPublish,
          redemptionsEnabled: capabilities.canRedeem,
        });
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [getToken, userId, revision]);

  const steps = snapshot ? [
    {
      key: "centers",
      title: "Centros y disponibilidad",
      ready: snapshot.availableDestinations > 0,
      description: snapshot.availableDestinations > 0
        ? String(snapshot.availableDestinations) + " destino(s) disponibles para solicitar entregas."
        : snapshot.activeCenters > 0
          ? "Hay centros activos, pero falta completar materiales o disponibilidad para recibir entregas."
          : "Todavía no hay centros operativos disponibles para recibir entregas.",
      href: "/admin/centers",
      action: "Gestionar centros",
    },
    {
      key: "verification",
      title: "Recepción y verificación",
      ready: snapshot.receiptEnabled && snapshot.verificationEnabled && snapshot.pointsEnabled,
      description: snapshot.receiptEnabled && snapshot.verificationEnabled && snapshot.pointsEnabled
        ? "El administrador puede recibir y verificar entregas de otros participantes, y acreditar sus EcoPuntos."
        : "El administrador ya tiene permiso para operar; falta habilitar alguna función de recepción, verificación o acreditación en el servidor.",
      href: "/admin",
      action: "Abrir bandeja de entregas",
    },
    {
      key: "rewards",
      title: "Recompensas disponibles",
      ready: snapshot.publishedRewards > 0 && snapshot.redemptionsEnabled,
      description: snapshot.publishedRewards > 0
        ? snapshot.redemptionsEnabled
          ? String(snapshot.publishedRewards) + " recompensa(s) publicadas y canje habilitado."
          : "Hay recompensas publicadas, pero el canje no está habilitado en el servidor."
        : "Publica una recompensa con inventario y cumplimiento confirmados.",
      href: "/admin/rewards",
      action: "Gestionar recompensas",
    },
  ] : [];

  const configurationLocked = Boolean(snapshot && (
    !snapshot.catalogEditing || !snapshot.catalogPublication ||
    !snapshot.rewardEditing || !snapshot.rewardPublication
  ));

  return <section aria-labelledby="operational-status-title" className="mt-5 space-y-4 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" data-testid="admin-operational-status">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="operational-status-title" className="font-display text-2xl text-[hsl(var(--primary))]">Estado operativo</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Información actualizada desde los servicios de EcoPulse. Accede a cada gestión desde aquí.</p>
      </div>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={status === "loading"} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 text-sm font-semibold disabled:opacity-50" data-testid="button-refresh-operational-status">
        <RefreshCw size={16} /> Actualizar
      </button>
    </div>
    {status === "loading" && <p role="status" className="rounded-xl bg-[hsl(var(--muted))] p-4 text-sm">Consultando centros, usuarios y recompensas…</p>}
    {status === "error" && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">No se pudo consultar el estado operativo. Las gestiones siguen accesibles; vuelve a intentar.</p>}
    {status === "ready" && <div className="grid gap-3 md:grid-cols-3">
      {steps.map(step => <article key={step.key} className="flex flex-col rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={"operational-step-" + step.key}>
        <div className="flex items-center gap-2">
          {step.ready ? <CheckCircle2 size={19} className="shrink-0 text-emerald-700" aria-hidden="true" /> : <CircleAlert size={19} className="shrink-0 text-amber-700" aria-hidden="true" />}
          <h3 className="font-semibold text-[hsl(var(--primary))]">{step.title}</h3>
        </div>
        <p className="mt-3 flex-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{step.description}</p>
        <Link href={step.href} className="mt-4 inline-flex min-h-10 items-center gap-2 self-start text-sm font-bold text-[hsl(var(--primary))] underline">{step.action} <ArrowRight size={15} /></Link>
      </article>)}
    </div>}
    {status === "ready" && configurationLocked && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" data-testid="admin-operational-configuration-warning">Algunas gestiones están deshabilitadas por configuración del servidor. Comprueba en Render los permisos de catálogo y recompensas antes de intentar publicarlas.</p>}
  </section>;
}
