// A datetime-local field is expressed in the user's local timezone, not UTC.
const MIN_LEAD_MS = 5 * 60_000;
const MAX_LEAD_MS = 180 * 24 * 60 * 60_000;

export function localDateTimeValue(date: Date): string {
  if (!Number.isFinite(date.valueOf())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function minimumHandoffDateTime(now: Date = new Date()): string {
  // Browser-level min is a little ahead of the server's 5-minute safety margin,
  // so a valid value isn't rejected after a few seconds of network delay.
  return localDateTimeValue(new Date(now.getTime() + 10 * 60_000));
}

export function defaultHandoffDateTime(now: Date = new Date(), previous: Date | null = null): string {
  if (previous && Number.isFinite(previous.valueOf()) &&
      previous.getTime() > now.getTime() + 15 * 60_000 &&
      previous.getTime() <= now.getTime() + MAX_LEAD_MS) {
    return localDateTimeValue(previous);
  }
  // Tomorrow at the next quarter-hour, allowing time to coordinate with people.
  const suggested = new Date(now.getTime() + 24 * 60 * 60_000);
  suggested.setMinutes(Math.ceil(suggested.getMinutes() / 15) * 15, 0, 0);
  return localDateTimeValue(suggested);
}

export function handoffDateTimeError(input: string, now: Date = new Date()): string | null {
  if (!input) return "Selecciona la fecha y la hora de coordinación.";
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.valueOf())) return "La fecha u hora indicada no es válida.";
  if (parsed.getTime() < now.getTime() + MIN_LEAD_MS) {
    return "La fecha ya pasó o está demasiado cerca. Selecciona una hora futura, al menos 10 minutos desde ahora.";
  }
  if (parsed.getTime() > now.getTime() + MAX_LEAD_MS) {
    return "La fecha no puede superar los próximos 180 días.";
  }
  return null;
}
