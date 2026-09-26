import { timingSafeEqual } from "node:crypto";

export function authorizationMatches(
  header: string | undefined,
  expected: string,
): boolean {
  if (!header) return false;
  const match = /^(Bearer)\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const provided = match[2] ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
