import { useAuth } from "@clerk/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { activationIntent, clearActivationIntent } from "./platform-activation-intent";

const apiUrl = import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001";
function storage() { try { return window.sessionStorage; } catch { return null; } }
type Module = { key: string; title: string; ready: boolean; enabled: boolean; missing: string[]; href: string };
type Asset = { key: string; title: string; filename: string; contentType: string; bytes: number; fulfillmentReference: string };
type Status = { activationReady: boolean; modules: Module[]; digitalAssets: Asset[] };

export function PlatformActivationPanel() {
  const { userId, getToken } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const pending = useRef<{ userId: string; key: string } | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setError("");
    setMessage("");
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw Error("session_required");
        const response = await fetch(apiUrl + "/api/pilot/admin/platform", { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw Error("status_unavailable");
        const body: Status = await response.json();
        if (!Array.isArray(body.modules) || !Array.isArray(body.digitalAssets) || typeof body.activationReady !== "boolean") throw Error("invalid_response");
        if (!controller.signal.aborted) setStatus(body);
      } catch { if (!controller.signal.aborted) setError("No se pudo consultar la configuración. Comprueba tu sesión y reintenta."); }
    })();
    return () => controller.abort();
  }, [userId, getToken, revision]);

  useEffect(() => {
    currentUser.current = userId;
    setBusy(inFlight.current);
    return () => { currentUser.current = undefined; };
  }, [userId]);

  async function activate() {
    if (!userId || inFlight.current || !status?.activationReady) return;
    const account = userId;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    pending.current = activationIntent(account, pending.current, storage(), () => crypto.randomUUID());
    try {
      const token = await getToken();
      if (!token || currentUser.current !== account) throw Error("session_changed");
      const response = await fetch(apiUrl + "/api/pilot/admin/platform/activate", { method: "POST", cache: "no-store",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "Idempotency-Key": pending.current!.key }, body: "{}" });
      if (!response.ok) {
        // Preserve the key on ambiguous server/network failures; a rejected
        // request can be retried with a fresh intent after correcting its cause.
        if (response.status >= 400 && response.status < 500) { clearActivationIntent(account, storage()); pending.current = null; }
        throw Error("activation_unconfirmed");
      }
      const body: { modules: Module[] } = await response.json();
      if (!Array.isArray(body.modules)) throw Error("invalid_response");
      if (currentUser.current !== account) return;
      clearActivationIntent(account, storage());
      pending.current = null;
      setStatus(previous => previous ? { ...previous, modules: body.modules } : null);
      setMessage("Activación guardada. Revisa los requisitos pendientes abajo. No se han publicado recursos ni creado entregas, inventario o EcoPuntos.");
    } catch {
      if (currentUser.current === account) setError("La activación no quedó confirmada. Reintenta: se conserva la misma solicitud para evitar duplicados.");
    } finally {
      inFlight.current = false;
      if (currentUser.current === account) setBusy(false);
    }
  }

  async function previewAsset(asset: Asset) {
    if (downloading) return;
    const account = userId;
    setDownloading(asset.key);
    setError("");
    try {
      const token = await getToken();
      if (!token || currentUser.current !== account) throw Error("session_required");
      const response = await fetch(apiUrl + "/api/pilot/admin/digital-assets/" + encodeURIComponent(asset.key) + "/download", { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== asset.contentType) throw Error("download_unavailable");
      const blob = await response.blob();
      if (!blob.size || currentUser.current !== account) throw Error("download_unavailable");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = asset.filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (currentUser.current === account) setError("No se pudo descargar el archivo real. Revisa tu sesión y reintenta."); }
    finally { if (currentUser.current === account) setDownloading(null); }
  }

  return <section className="mt-5 space-y-4 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" aria-labelledby="platform-activation-title" data-testid="platform-activation-panel">
    <h2 id="platform-activation-title" className="font-display text-2xl">Activación de módulos</h2>
    <p className="text-sm">Activa las funciones preparadas sin modificar los recursos publicados. La disponibilidad y los permisos se vuelven a comprobar en cada operación. Un único administrador puede verificar entregas ajenas; nunca las propias.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => void activate()} disabled={busy || !status?.activationReady} className="min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-activate-platform">{busy ? "Activando…" : "Activar plataforma"}</button>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={busy} className="min-h-11 rounded-full border px-5 font-semibold" data-testid="button-refresh-platform">Actualizar requisitos</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">{message}</p>}
    {!status && !error && <p role="status">Consultando requisitos…</p>}
    {status && !status.activationReady && <p role="alert">La infraestructura de activación no está disponible. Las gestiones existentes se conservan; falta completar la actualización del servicio.</p>}
    <div className="grid gap-3 md:grid-cols-2">{status?.modules.map(module => <article key={module.key} className="rounded-2xl border p-4" data-testid={"platform-module-" + module.key}>
      <h3 className="font-semibold">{module.title}</h3>
      <p className="mt-2 text-sm">{module.ready ? module.enabled ? "Habilitado · requisitos comprobados" : "Preparado para activar" : "Requisitos pendientes"}</p>
      {module.missing.length > 0 && <ul className="mt-2 list-inside list-disc text-sm">{module.missing.map(item => <li key={item}>{item}</li>)}</ul>}
      <Link href={module.href} className="mt-3 inline-flex min-h-10 items-center font-semibold underline">Abrir gestión</Link>
    </article>)}</div>
    {status && <div className="space-y-3 border-t pt-5" data-testid="admin-digital-asset-library">
      <h3 className="font-display text-xl">Archivos digitales disponibles</h3>
      <p className="text-sm">Descarga y revisa el archivo real antes de crear o publicar su recompensa. Esta revisión no crea inventario ni canjes y no acredita EcoPuntos.</p>
      <ul className="space-y-3">{status.digitalAssets.map(asset => <li key={asset.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <span><strong>{asset.title}</strong><span className="block text-xs">{asset.filename} · {asset.bytes} bytes</span></span>
        <button type="button" disabled={Boolean(downloading)} onClick={() => void previewAsset(asset)} className="min-h-11 rounded-full border px-4 font-semibold disabled:opacity-50" data-testid={"button-preview-digital-" + asset.key}>{downloading === asset.key ? "Descargando…" : "Descargar archivo real"}</button>
      </li>)}</ul>
      <Link href="/admin/rewards" className="inline-flex min-h-11 items-center font-semibold underline">Crear o gestionar recompensas y precios</Link>
    </div>}
  </section>;
}
