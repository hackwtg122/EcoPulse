import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/react";
import { loadAdminUsers, PilotApiError, updateAdminUserRole, type AdminUser, type AdminUserRole } from "@/pilot-api";

const apiUrl = import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001";

const roleLabels: Record<AdminUserRole, string> = {
  participant: "Participante",
  verifier: "Verificador",
  admin: "Administrador",
};

const roleDescriptions: Record<AdminUserRole, string> = {
  participant: "Registra escaneos y entregas; no valida ni administra.",
  verifier: "Recibe y verifica entregas físicas en un centro autorizado.",
  admin: "Administra catálogo, recompensas y roles de otras cuentas.",
};

const errorLabels: Record<string, string> = {
  admin_required: "Tu sesión ya no tiene permisos de administrador. Vuelve a iniciar sesión.",
  cannot_self_demote: "No puedes quitarte tu propio rol de administrador.",
  last_admin_protected: "No puedes dejar el sistema sin administradores. Promueve otra cuenta primero.",
  user_not_found: "La cuenta ya no existe en EcoPulse.",
  invalid_role: "El rol solicitado no es válido.",
  unexpected_fields: "La solicitud contenía campos no permitidos.",
  permissions_unavailable: "La base de datos no permite escribir roles en este momento.",
  schema_migration_required: "Falta la migración de auditoría. No se ha aplicado el cambio de rol.",
  pilot_api_error: "La operación falló en el servidor. Intenta de nuevo.",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdminUsersPanel({ role }: { role: string | undefined }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const currentUserId = user?.id ?? "";
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adminCount, setAdminCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [auditWarning, setAuditWarning] = useState(false);
  const [savingId, setSavingId] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (after: string | null = null) => {
    if (role !== "admin") { setStatus("error"); setError("admin_required"); return; }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "session_required");
      const payload = await loadAdminUsers(apiUrl, token, controller.signal, fetch, after);
      if (!controller.signal.aborted) {
        setUsers(previous => after
          ? [...new Map([...previous, ...payload.users].map(row => [row.clerkUserId, row])).values()]
          : payload.users);
        setAdminCount(payload.adminCount);
        setNextCursor(payload.nextCursor);
        setStatus("ready");
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setError(caught instanceof PilotApiError ? caught.code : "pilot_api_error");
    }
  }, [getToken, role, currentUserId]);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  const changeRole = async (target: AdminUser, nextRole: AdminUserRole) => {
    if (savingId || status !== "ready" || target.role === nextRole) return;
    if (!window.confirm(`¿Cambiar ${target.clerkUserId} de ${roleLabels[target.role]} a ${roleLabels[nextRole]}?`)) return;
    const controller = new AbortController();
    setSavingId(target.clerkUserId);
    setError("");
    setNotice("");
    setAuditWarning(false);
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "session_required");
      const result = await updateAdminUserRole(apiUrl, token, target.clerkUserId, nextRole, controller.signal);
      setNotice(result.changed
        ? `${target.clerkUserId} ahora es ${roleLabels[nextRole].toLowerCase()}.`
        : "La cuenta ya tenía ese rol; no hubo cambios.");
      setAuditWarning(result.changed && !result.auditRecorded);
      await refresh();
    } catch (caught) {
      setError(caught instanceof PilotApiError ? caught.code : "pilot_api_error");
    } finally {
      setSavingId("");
    }
  };

  if (role !== "admin") {
    return <p className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-sm" role="alert" data-testid="admin-users-restricted">
      Solo un administrador puede gestionar los roles de las cuentas.
    </p>;
  }

  return <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" data-testid="admin-users-panel">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl text-[hsl(var(--primary))]">Usuarios y roles</h2>
        <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Los roles se validan en el servidor. Cada cambio queda registrado en la auditoría y el sistema
          nunca puede quedarse sin administradores. Las cuentas nuevas entran siempre como participantes.
        </p>
        <p className="mt-2 text-sm font-semibold" data-testid="admin-users-count">
          {adminCount} administrador{adminCount === 1 ? "" : "es"} · {users.length} cuenta{users.length === 1 ? "" : "s"} mostradas
        </p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={status === "loading"} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 py-2 text-sm font-semibold disabled:opacity-50" data-testid="button-refresh-admin-users">
        Actualizar
      </button>
    </div>

    {error && <p className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert" data-testid="admin-users-error">
      {errorLabels[error] || `No se pudo completar la operación (${error}).`}
    </p>}
    {notice && <p className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900" role="status" data-testid="admin-users-notice">{notice}</p>}
    {auditWarning && <p className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert" data-testid="admin-users-audit-warning">
      El cambio se aplicó, pero la auditoría no está disponible. Falta aplicar la migración 0004 en la base de datos.
    </p>}
    {status === "loading" && <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" role="status">Cargando cuentas…</p>}

    <ul className="mt-5 divide-y divide-[hsl(var(--border))]">
      {users.map((row) => {
        const isSelf = row.clerkUserId === currentUserId;
        const isLastAdmin = row.role === "admin" && adminCount <= 1;
        const lockReason = isSelf
          ? "No puedes cambiar tu propio rol."
          : isLastAdmin
            ? "Es el último administrador: promueve otra cuenta antes de cambiarlo."
            : "";
        return <li key={row.clerkUserId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`admin-user-${row.clerkUserId}`}>
          <div className="min-w-0">
            <p className="truncate font-semibold">{row.clerkUserId}{isSelf ? " · Tú" : ""}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Alta: {formatDate(row.createdAt)}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{roleDescriptions[row.role]}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-xs font-bold" data-testid={`admin-user-role-${row.clerkUserId}`}>{roleLabels[row.role]}</span>
            <select
              aria-label={`Rol de ${row.clerkUserId}`}
              value={row.role}
              disabled={isSelf || isLastAdmin || savingId === row.clerkUserId}
              title={lockReason}
              onChange={(event) => void changeRole(row, event.target.value as AdminUserRole)}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              data-testid={`admin-user-select-${row.clerkUserId}`}
            >
              {(Object.keys(roleLabels) as AdminUserRole[]).map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
            </select>
          </div>
        </li>;
      })}
    </ul>
    {nextCursor && <button type="button" disabled={status === "loading" || Boolean(savingId)} onClick={() => void refresh(nextCursor)} className="mt-4 min-h-11 rounded-full border border-[hsl(var(--border))] px-5 py-2 text-sm font-semibold disabled:opacity-50" data-testid="button-load-more-admin-users">Cargar más cuentas</button>}
    {status === "ready" && users.length === 0 && <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Aún no hay cuentas registradas.</p>}
  </section>;
}
