/**
 * Removes anything key-shaped from text that is about to be logged or stored.
 *
 * This exists because of a real incident rather than a precaution. The comment that used
 * to sit above the embedding provider's error handling asserted that provider error
 * bodies "contain no secrets"; a 401 disproved it. The response echoed the API key back —
 * masked as `sk-or-v1***…73bf`, but with its true last four characters — and that string
 * is written to `ingestion_events.message`, which the admin dashboard renders. CLAUDE.md
 * §9 says never log an API key, and a partial key is still a key.
 *
 * Deliberately broad. It matches the masked forms providers echo back as well as whole
 * keys, because over-redacting costs a slightly less useful log line and under-redacting
 * writes credentials into a table that a browser reads.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9._*-]{8,}/g, "$1-<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._*-]{8,}/gi, "Bearer <redacted>");
}
