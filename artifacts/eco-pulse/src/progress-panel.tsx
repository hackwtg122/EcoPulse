import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { Award, Check, Flame, Lock, RefreshCw, Sparkles, Target, Trophy } from "lucide-react";
import { loadPilotProgress, PilotApiError, type PilotProgress } from "@/pilot-api";
import { explorerBadges, readMaterialViews } from "@/explorer-progress";

const xpRingColor = "hsl(var(--primary))";

export function ProgressPanel({ apiUrl }: { apiUrl: string }) {
  const { getToken, userId } = useAuth();
  const [progress, setProgress] = useState<PilotProgress | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [explored, setExplored] = useState<string[]>([]);

  useEffect(() => { setExplored(readMaterialViews()); }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    if (!userId) { setStatus("error"); setMessage("Inicia sesión para ver tu progreso."); return () => controller.abort(); }
    setStatus("loading");
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new PilotApiError(401, "missing_session_token");
        const result = await loadPilotProgress(apiUrl, token, controller.signal);
        if (!controller.signal.aborted) { setProgress(result); setStatus("ready"); }
      } catch (error) {
        if (controller.signal.aborted) return;
        const code = error instanceof PilotApiError ? error.status : 0;
        setStatus("error");
        setMessage(code === 401 ? "Tu sesión venció. Vuelve a iniciar sesión." : "No pudimos cargar tu progreso. Inténtalo de nuevo.");
      }
    })();
    return () => controller.abort();
  }, [apiUrl, getToken, userId, refresh]);

  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  const levelProgress = useMemo(() => {
    if (!progress || progress.nextLevelXp === null || progress.nextLevelXp === undefined) return null;
    const currentBase = progress.level === 1 ? 0 : (progress.nextLevelXp - (progress.xpToNextLevel ?? 0));
    const span = progress.nextLevelXp - currentBase;
    const filled = span > 0 ? Math.max(0, Math.min(1, (progress.ecoXp - currentBase) / span)) : 1;
    return { percent: Math.round(filled * 100) };
  }, [progress]);

  if (status === "loading") return <p role="status" aria-busy="true" className="rounded-[2rem] bg-[hsl(var(--muted))] p-6 text-sm">Cargando tu progreso…</p>;
  if (status === "error") return <div className="rounded-[2rem] border border-[hsl(var(--accent)/.4)] p-6 text-center" role="alert"><p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p><button onClick={retry} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]"><RefreshCw size={15} /> Reintentar</button></div>;
  if (!progress) return null;

  return <div className="space-y-5">
    <section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))] sm:p-9" data-testid="progress-level-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[hsl(var(--primary-foreground)/.7)]">Nivel actual</p>
          <p className="mt-1 font-display text-5xl text-[hsl(var(--secondary))]" data-testid="progress-level">{progress.level}. {progress.levelTitle}</p>
          <p className="mt-2 text-sm text-[hsl(var(--primary-foreground)/.75)]"><Sparkles size={15} className="mr-1 inline text-[hsl(var(--secondary))]" /><span data-testid="progress-xp">{progress.ecoXp.toLocaleString("es-CO")}</span> EcoXP · progreso educativo, no canjeable</p>
        </div>
        <div className="text-right"><p className="text-sm text-[hsl(var(--primary-foreground)/.7)]">Racha actual</p><p className="font-display text-4xl text-[hsl(var(--secondary))]" data-testid="progress-streak">{progress.streakDays}</p><p className="text-xs text-[hsl(var(--primary-foreground)/.62)]">días consecutivos</p></div>
      </div>
      {levelProgress && <div className="mt-6"><div className="flex justify-between text-xs text-[hsl(var(--primary-foreground)/.72)]"><span data-testid="progress-next-level">Nivel {progress.nextLevel}: faltan {progress.xpToNextLevel} EcoXP</span><span>{levelProgress.percent}%</span></div><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[hsl(var(--primary-foreground)/.16)]"><div className="h-full rounded-full bg-[hsl(var(--secondary))]" style={{ width: `${levelProgress.percent}%` }} data-testid="progress-level-bar" /></div></div>}
      {!levelProgress && <p className="mt-6 text-sm text-[hsl(var(--primary-foreground)/.72)]">Alcanzaste el nivel máximo actual. Nuevos niveles se añadirán cuando haya más formas reales de progresar.</p>}
    </section>

    <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-7" data-testid="progress-missions">
      <div className="flex items-center gap-2"><Target size={21} className="text-[hsl(var(--primary))]" /><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Misiones</h2></div>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Cada misión se completa con eventos reales de tu cuenta en PostgreSQL. Ninguna se simula.</p>
      <ul className="mt-5 space-y-3">{progress.missions.map((mission) => <li key={mission.id} className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`mission-${mission.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-[hsl(var(--primary))]">{mission.title}</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{mission.description}</p></div><span className="shrink-0 rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--primary))]">+{mission.xpReward} XP</span></div><div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className={`h-full rounded-full ${mission.completed ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--accent))]"}`} style={{ width: `${Math.round((mission.progress / Math.max(1, mission.target)) * 100)}%` }} /></div><span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{mission.progress}/{mission.target}</span>{mission.completed && <Check size={17} className="text-[hsl(var(--primary))]" />}</div></li>)}</ul>
    </section>

    <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-7" data-testid="progress-badges">
      <div className="flex items-center gap-2"><Award size={21} className="text-[hsl(var(--primary))]" /><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Insignias</h2></div>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Se ganan con logros reales, no con fotos ni actividad simulada.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{progress.badges.map((badge) => <div key={badge.id} className={`rounded-2xl border p-4 ${badge.earned ? "border-[hsl(var(--primary)/.4)] bg-[hsl(var(--secondary)/.14)]" : "border-[hsl(var(--border))] opacity-70"}`} data-testid={`badge-${badge.id}`}><div className="flex items-center gap-2">{badge.earned ? <Trophy size={17} className="text-[hsl(var(--primary))]" /> : <Lock size={16} className="text-[hsl(var(--muted-foreground))]" />}<p className="font-semibold text-[hsl(var(--primary))]">{badge.title}</p></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{badge.description}</p>{badge.earned && badge.earnedAt && <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Ganada el {new Date(badge.earnedAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}</p>}</div>)}</div>
    </section>

    <section className="rounded-[2rem] border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--card))] p-6 sm:p-7" data-testid="progress-explorer">
      <div className="flex items-center gap-2"><Sparkles size={20} className="text-[hsl(var(--accent))]" /><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Explorador</h2><span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Solo en este navegador</span></div>
      <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Cuántas fichas de material has abierto. Este contador vive únicamente en este navegador; no es EcoXP del servidor ni sobrevive a otro dispositivo.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">{explorerBadges.map((badge) => { const earned = explored.length >= badge.target; return <div key={badge.id} className={`rounded-2xl border p-4 ${earned ? "border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.1)]" : "border-[hsl(var(--border))] opacity-70"}`} data-testid={`explorer-${badge.id}`}><div className="flex items-center gap-2">{earned ? <Trophy size={16} className="text-[hsl(var(--accent))]" /> : <Lock size={15} className="text-[hsl(var(--muted-foreground))]" />}<p className="font-semibold text-[hsl(var(--primary))]">{badge.title}</p></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{badge.description}</p><p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">{Math.min(explored.length, badge.target)}/{badge.target}</p></div>; })}</div>
      <button onClick={retry} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="button-refresh-progress"><RefreshCw size={15} /> Actualizar progreso</button>
    </section>

    <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] p-6 sm:p-7" data-testid="progress-rules">
      <div className="flex items-center gap-2"><Flame size={20} className="text-[hsl(var(--primary))]" /><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Cómo se gana EcoXP</h2></div>
      <ul className="mt-3 space-y-1.5 text-sm text-[hsl(var(--muted-foreground))]">{progress.rules.map((rule) => <li key={rule} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: xpRingColor }} />{rule}</li>)}</ul>
    </section>
  </div>;
}
