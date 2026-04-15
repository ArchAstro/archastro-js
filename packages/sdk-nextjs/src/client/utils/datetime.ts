/**
 * Parse a server timestamp string into a Date.
 * Server timestamps may lack a timezone designator; treat them as UTC.
 */
export function parseServerTimestamp(
  value: string | null | undefined,
): Date | null {
  const s = (value ?? "").trim();
  if (!s) return null;

  const hasTimezone =
    /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{2}\d{2}|[+-]\d{2})$/.test(s);
  const normalized = hasTimezone ? s : `${s}Z`;

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}
