import { useAuth } from "@clerk/react";
import { AlertTriangle, BookOpen, Camera, Check, ImagePlus, MapPin, MessageCircle, Pencil, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { createPilotScan, PilotApiError } from "./pilot-api";
import { isManualScanCategory, manualScanCategories, manualScanGuidance, materialCategoryByScan, type ManualScanCategory } from "./scan-catalog";

const maximumImageBytes = 5 * 1024 * 1024;

type AiConfidence = "high" | "medium" | "low";
type AiSuggestion = { category: ManualScanCategory | "unknown"; explanation: string; ambiguous: boolean; confidence: AiConfidence | null };
type Capabilities = { enabled: boolean; missing: string[] };

const confidenceLabels: Record<AiConfidence, string> = { high: "Confianza alta según la imagen", medium: "Confianza media según la imagen", low: "Confianza baja según la imagen" };
const classifyErrorMessages: Record<string, string> = {
  ai_rate_limited: "Se alcanzó el límite de análisis con IA. Inténtalo más tarde o clasifica manualmente.",
  ai_provider_unavailable: "El proveedor de IA no respondió. Puedes clasificar el residuo manualmente.",
  ai_quota_store_unavailable: "El control de cuota de IA no está disponible. Para proteger tu cuenta, analiza manualmente por ahora.",
  ai_provider_unconfigured: "El análisis con IA todavía no está configurado. La clasificación manual sigue disponible.",
  invalid_ai_category: "El proveedor devolvió una categoría no válida. Intenta con otra foto o clasifica manualmente.",
  invalid_ai_response: "El proveedor devolvió una respuesta no válida. Intenta con otra foto o clasifica manualmente.",
  invalid_image: "No se pudo procesar la imagen. Elige un JPG o PNG válido de hasta 5 MB.",
  png_required: "El servidor solo acepta imágenes PNG procesadas. Vuelve a intentarlo desde el panel.",
  missing_session_token: "Tu sesión expiró. Inicia sesión de nuevo para analizar imágenes.",
  network: "No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.",
};

function parseSuggestion(body: unknown): AiSuggestion | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (row.source !== "ai_suggestion" || row.persisted !== false || row.points !== 0) return null;
  if (!isManualScanCategory(row.category) && row.category !== "unknown") return null;
  if (typeof row.explanation !== "string" || !row.explanation.trim() || row.explanation.length > 400) return null;
  if (typeof row.ambiguous !== "boolean") return null;
  const confidence = row.confidence === null ? null
    : row.confidence === "high" || row.confidence === "medium" || row.confidence === "low" ? row.confidence : undefined;
  if (confidence === undefined) return null;
  // Ambiguous or unknown results never display a grounded confidence.
  if (row.ambiguous || row.category === "unknown") return { category: row.category, explanation: row.explanation, ambiguous: true, confidence: null };
  return { category: row.category, explanation: row.explanation, ambiguous: false, confidence };
}

export function AiScanPanel({ apiUrl, onSaved }: { apiUrl: string; onCategory: (category: ManualScanCategory) => void; onSaved?: () => void }) {
  const { getToken, userId } = useAuth();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [editedCategory, setEditedCategory] = useState<ManualScanCategory | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [savedCategory, setSavedCategory] = useState<ManualScanCategory | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCapabilities(null); setCapabilitiesLoaded(false); resetResult();
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const response = await fetch(`${apiUrl}/api/pilot/scans/ai-capabilities`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (response.ok) {
          const body = await response.json() as { enabled?: unknown; missing?: unknown };
          if (!controller.signal.aborted) {
            setCapabilities({ enabled: body?.enabled === true, missing: Array.isArray(body?.missing) ? body.missing.filter((item): item is string => typeof item === "string") : [] });
          }
        }
      } catch { /* leave unavailable */ }
      finally { if (!controller.signal.aborted) setCapabilitiesLoaded(true); }
    })();
    return () => { controller.abort(); request.current?.abort(); saveRequest.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, getToken, userId]);

  function resetResult() {
    setSuggestion(null); setEditedCategory(null); setEditing(false);
    setSaveStatus("idle"); setSavedCategory(null); idempotencyKey.current = null;
  }

  const select = useCallback((candidate: File | null) => {
    setError(""); resetResult(); setConsent(false);
    setPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null; });
    if (!candidate) { setFile(null); return; }
    if (!["image/jpeg", "image/png"].includes(candidate.type) || candidate.size < 1 || candidate.size > maximumImageBytes) {
      setFile(null); setError("Elige un JPG o PNG de hasta 5 MB."); return;
    }
    setFile(candidate);
    setPreviewUrl(URL.createObjectURL(candidate));
  }, []);

  const removeImage = () => {
    setPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null; });
    setFile(null); setConsent(false); resetResult(); setError("");
  };

  const analyze = async () => {
    if (!file || !capabilities?.enabled || !consent || status === "sending" || saveStatus === "saving") return;
    const controller = new AbortController(); request.current = controller;
    setStatus("sending"); setError(""); resetResult();
    try {
      const bitmap = await createImageBitmap(file);
      const factor = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      canvas.width = 0; canvas.height = 0;
      if (!png || png.size < 1 || png.size > maximumImageBytes) throw new Error("image_too_large");
      const token = await getToken();
      if (!token) throw new Error("missing_session_token");
      const response = await fetch(`${apiUrl}/api/pilot/scans/classify`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png", "X-AI-Consent": "true" }, body: png, signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        let code = "network";
        try { const body = await response.json() as { error?: unknown }; if (typeof body?.error === "string") code = body.error; } catch { /* keep generic */ }
        throw new Error(code);
      }
      const parsed = parseSuggestion(await response.json());
      if (!parsed) throw new Error("invalid_ai_response");
      if (!controller.signal.aborted) { setSuggestion(parsed); if (parsed.category !== "unknown") setEditedCategory(parsed.category); }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = cause instanceof Error && cause.message in classifyErrorMessages ? cause.message : "network";
      setError(classifyErrorMessages[code] ?? classifyErrorMessages.network!);
    } finally { if (request.current === controller) request.current = null; setStatus("idle"); }
  };

  const categoryToSave = editedCategory;
  const confirmSave = async () => {
    if (!categoryToSave || saveStatus === "saving" || saveStatus === "saved") return;
    const controller = new AbortController(); saveRequest.current = controller;
    setSaveStatus("saving"); setError("");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      idempotencyKey.current ??= `scan_${crypto.randomUUID()}`;
      await createPilotScan(apiUrl, token, categoryToSave, idempotencyKey.current, controller.signal);
      idempotencyKey.current = null;
      setSaveStatus("saved"); setSavedCategory(categoryToSave); setEditing(false);
      onSaved?.();
    } catch (cause) {
      if (controller.signal.aborted) return;
      const status_code = cause instanceof PilotApiError ? cause.status : 0;
      if (status_code === 401) setError("Tu sesión expiró. Inicia sesión de nuevo para guardar la clasificación.");
      else if (status_code === 429) setError("Límite de solicitudes alcanzado. Espera un minuto y reintenta.");
      else setError("No se pudo guardar la clasificación. Se conservan tus datos; puedes reintentar.");
      setSaveStatus("idle");
    } finally { if (saveRequest.current === controller) saveRequest.current = null; }
  };

  const discardResult = () => { resetResult(); setConsent(false); };

  const activeCategory = saveStatus === "saved" && savedCategory ? savedCategory : categoryToSave;
  return (
    <section className="mt-5 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" aria-labelledby="ai-scan-title" data-testid="ai-scan-panel">
      <div className="flex items-center gap-3"><Sparkles className="text-[hsl(var(--primary))]"/><h2 id="ai-scan-title" className="font-display text-2xl text-[hsl(var(--primary))]">EcoScan AI</h2></div>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">La IA analiza la fotografía y sugiere una categoría con una explicación. Debes revisarla, confirmarla o corregirla antes de registrarla. No valida entregas ni concede puntos.</p>

      {!capabilitiesLoaded && <p role="status" className="mt-4 text-sm">Comprobando disponibilidad del análisis con IA…</p>}
      {capabilitiesLoaded && capabilities !== null && !capabilities.enabled && (
        <div role="status" className="mt-4 rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm" data-testid="ai-scan-unavailable">
          <p className="font-semibold">El análisis con IA no está configurado todavía.</p>
          {capabilities.missing.length > 0 && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Configuración faltante en el servidor: {capabilities.missing.join(", ")}.</p>}
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">La clasificación manual de abajo sigue disponible y guarda el mismo registro.</p>
        </div>
      )}

      {capabilitiesLoaded && capabilities?.enabled && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))]">
              <Camera size={16} /> Tomar foto
              <input type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" data-testid="input-ai-camera" onChange={event => { select(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 text-sm font-semibold text-[hsl(var(--primary))]">
              <ImagePlus size={16} /> Subir imagen
              <input type="file" accept="image/jpeg,image/png" className="sr-only" data-testid="input-ai-upload" onChange={event => { select(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
            </label>
          </div>

          {file && previewUrl && (
            <div className="flex flex-wrap items-center gap-4" data-testid="ai-scan-preview">
              <img src={previewUrl} alt="Vista previa del residuo a analizar" className="h-28 w-28 rounded-2xl border border-[hsl(var(--border))] object-cover" />
              <div className="min-w-0 flex-1 text-xs text-[hsl(var(--muted-foreground))]">
                <p className="truncate font-semibold text-[hsl(var(--foreground))]">{file.name}</p>
                <p>{(file.size / 1024).toFixed(0)} KB · JPG o PNG</p>
              </div>
              <button type="button" onClick={removeImage} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-4 text-sm font-semibold" data-testid="button-ai-remove-image"><Trash2 size={15} /> Quitar foto</button>
            </div>
          )}

          {file && !suggestion && (
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} data-testid="checkbox-ai-consent" />Autorizo enviar esta imagen al proveedor de IA para recibir una sugerencia. EcoPulse no la guarda.</label>
          )}
          {file && !suggestion && (
            <button type="button" disabled={!consent || status === "sending"} onClick={() => void analyze()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-ai-analyze">
              <Sparkles size={16}/>{status === "sending" ? "Analizando…" : "Analizar imagen"}
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-800" data-testid="ai-scan-error">{error}</p>}

      {suggestion && (
        <div className="mt-5 space-y-4 rounded-2xl border border-[hsl(var(--border))] p-5" data-testid="ai-scan-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Sugerencia de EcoScan AI</p>
            {suggestion.confidence && <span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-xs font-semibold">{confidenceLabels[suggestion.confidence]}</span>}
          </div>

          {suggestion.ambiguous || suggestion.category === "unknown" ? (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="ai-scan-ambiguous">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <p>La imagen no muestra un material predominante con claridad, así que no hay una sugerencia segura. Elige la categoría manualmente.</p>
            </div>
          ) : (
            <p className="text-lg font-semibold">Material probable: <strong data-testid="ai-scan-category">{manualScanGuidance[suggestion.category as ManualScanCategory].label}</strong></p>
          )}

          <p className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="ai-scan-explanation">{suggestion.explanation}</p>

          {activeCategory && (
            <div className="rounded-xl bg-[hsl(var(--muted))] p-4 text-sm">
              <p><strong>Preparación recomendada:</strong> {manualScanGuidance[activeCategory].instructions}</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Contenedor de referencia: {manualScanGuidance[activeCategory].container}.</p>
            </div>
          )}

          {editing && saveStatus !== "saved" && (
            <div className="space-y-3" data-testid="ai-scan-edit">
              <label className="block text-sm font-semibold">Corrige la categoría sugerida
                <select value={editedCategory ?? ""} onChange={event => setEditedCategory(isManualScanCategory(event.target.value) ? event.target.value : null)} className="mt-2 block w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm" data-testid="select-ai-edit-category">
                  <option value="">Selecciona una categoría…</option>
                  {manualScanCategories.map(category => <option key={category} value={category}>{manualScanGuidance[category].label}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!editedCategory || saveStatus === "saving"} onClick={() => void confirmSave()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-ai-save-edited">{saveStatus === "saving" ? "Guardando…" : "Guardar corrección"}</button>
                <button type="button" onClick={() => { setEditing(false); setEditedCategory(suggestion.category !== "unknown" ? suggestion.category as ManualScanCategory : null); }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 text-sm font-semibold"><X size={15}/> Cancelar</button>
              </div>
            </div>
          )}

          {!editing && saveStatus === "idle" && (
            <div className="flex flex-wrap gap-2">
              {suggestion.category !== "unknown" && (
                <button type="button" onClick={() => void confirmSave()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="button-ai-confirm">
                  <Check size={16} />Confirmar y guardar
                </button>
              )}
              <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="button-ai-edit"><Pencil size={15} /> Editar categoría</button>
              <button type="button" onClick={discardResult} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 text-sm font-semibold text-[hsl(var(--muted-foreground))]" data-testid="button-ai-discard"><RotateCcw size={15} /> Rechazar resultado</button>
              {suggestion.category === "unknown" && (
                 <button type="button" onClick={() => { const selector = document.getElementById("manual-scan-category"); selector?.scrollIntoView({ behavior: "smooth", block: "center" }); selector?.focus(); }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="button-ai-manual-fallback">Elegir manualmente abajo</button>
              )}
            </div>
          )}

          {!editing && saveStatus === "saving" && (
            <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="ai-scan-saving">Guardando la clasificación confirmada…</p>
          )}

          {saveStatus === "saved" && savedCategory && (
            <div className="space-y-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status" data-testid="ai-scan-saved">
              <p className="flex items-center gap-2 font-semibold"><Check size={17} /> Clasificación registrada como “{manualScanGuidance[savedCategory].label}” (manual, confirmada por ti). Sin puntos ni entrega física.</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/materials?category=${materialCategoryByScan[savedCategory]}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-[hsl(var(--primary))] shadow-sm" data-testid="link-ai-materials"><BookOpen size={14}/> Materiales</Link>
                <Link href="/chat" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-[hsl(var(--primary))] shadow-sm" data-testid="link-ai-guide"><MessageCircle size={14}/> Preguntar a EcoGuía</Link>
                <Link href={`/map?material=${savedCategory}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-[hsl(var(--primary))] shadow-sm" data-testid="link-ai-map"><MapPin size={14}/> Dónde entregarlo</Link>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
