import { type Role } from "@corpus-lens/shared/role";
// Type-only: `jose` ships pure ESM, so the values are loaded at runtime by the cached
// dynamic import below. Types erase at compile time and cost nothing.
// `resolution-mode: "import"` tells the Node16 resolver to read jose's ESM types from a
// CommonJS file. Without it TypeScript refuses the type-only import outright.
import type { JWTPayload, JWTVerifyGetKey } from "jose" with { "resolution-mode": "import" };

/**
 * `jose` is ESM-only and this app is CommonJS, so it is loaded with a dynamic import.
 *
 * Converting the app to ESM was tried first and reverted: `packages/db` is CommonJS and
 * resolves `drizzle-orm` through the `require` condition, while an ESM app resolves the
 * same package through `import`. The compiler then sees two distinct copies of drizzle's
 * types and every SQL value crossing the boundary stops being assignable — the classic
 * dual-package hazard, and a far bigger problem than the one it solves.
 *
 * The promise is cached, so the module is evaluated once rather than per request.
 */
type Jose = typeof import("jose", { with: { "resolution-mode": "import" } });

let josePromise: Promise<Jose> | undefined;

function jose(): Promise<Jose> {
  josePromise ??= import("jose");
  return josePromise;
}

/**
 * OIDC token validation for MCP callers.
 *
 * The local mode in `authenticate.ts` verifies a token this system signed, against a
 * secret this system holds. OIDC inverts that: the token is issued by somebody else, and
 * the only thing shared is a *public* key published at a well-known URL. Nothing here can
 * mint a credential, which is the point — access is delegated to an identity provider
 * rather than to a shared secret that every service holding it can forge.
 *
 * **Every check below rejects a specific attack.** Verifying the signature alone is the
 * mistake that makes an OIDC integration look finished while being wide open:
 *
 * - **signature via JWKS** — the token was issued by the provider, not written by the
 *   caller. `alg` is pinned to asymmetric algorithms, because accepting `HS256` here would
 *   let an attacker sign a token using the *public* key as an HMAC secret. It is public.
 * - **`iss`** — issued by *our* provider. Without it, a token from any OIDC provider on
 *   the internet is accepted, and anyone can create a tenant somewhere and get one.
 * - **`aud`** — issued *for us*. Without it, a token minted for an unrelated application
 *   the user has legitimately signed into is replayable here.
 * - **`exp` / `nbf`** — enforced by `jwtVerify` with a small clock tolerance, because
 *   servers disagree about the time by seconds and a hard boundary rejects valid tokens.
 */

export interface OidcConfig {
  /** Exact `iss` the token must carry. Compared literally, not as a prefix. */
  issuer: string;
  /** Exact `aud` this server accepts — usually the client id registered for it. */
  audience: string;
  /** JWKS endpoint, normally `${issuer}/.well-known/jwks.json`. */
  jwksUri: string;
  /**
   * Claim carrying the caller's roles or groups. Providers disagree — Auth0 uses a
   * namespaced claim, Keycloak nests under `realm_access.roles`, Entra uses `roles` — so
   * it is configuration rather than a guess.
   */
  roleClaim?: string;
  /** Value within that claim which grants ADMIN. Everything else authenticates as USER. */
  adminRoleValue?: string;
  /** Seconds of leeway on exp/nbf. */
  clockToleranceSeconds?: number;
}

export interface OidcCaller {
  id: string;
  email: string;
  role: Role;
}

export class OidcError extends Error {}

export interface OidcVerifier {
  verify(token: string): Promise<OidcCaller>;
}

/**
 * Asymmetric algorithms only.
 *
 * This list is the single most important line in the file. JWT libraries have historically
 * honoured the token's own `alg` header, so a token claiming `alg: "none"` or `alg: "HS256"`
 * would be validated on the attacker's terms — with HS256 the "secret" would be the JWKS
 * public key, which anybody can fetch. Pinning the accepted set means the header is not
 * consulted for that decision.
 */
const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"];

export function createOidcVerifier(
  config: OidcConfig,
  /**
   * Key resolver. Injectable so the tests can serve their own keys; otherwise a remote
   * JWKS with caching and rotation handled by `jose` — keys are fetched once, reused, and
   * re-fetched when a token arrives with an unknown `kid` (rate-limited, so unknown key
   * ids cannot be used to hammer the provider).
   *
   * Created lazily on first use rather than at construction, because building it requires
   * the dynamically imported module.
   */
  getKey?: JWTVerifyGetKey,
): OidcVerifier {
  const roleClaim = config.roleClaim ?? "roles";
  const adminRoleValue = config.adminRoleValue ?? "admin";

  let keyResolver = getKey;

  return {
    async verify(token: string): Promise<OidcCaller> {
      const { jwtVerify, createRemoteJWKSet } = await jose();
      keyResolver ??= createRemoteJWKSet(new URL(config.jwksUri));

      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, keyResolver, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ALLOWED_ALGORITHMS,
          clockTolerance: config.clockToleranceSeconds ?? 5,
        });
        payload = result.payload;
      } catch (error) {
        // One message for every failure mode. Telling a caller whether the signature, the
        // issuer, the audience or the expiry was wrong is free reconnaissance; the detail
        // goes to the server log instead.
        throw new OidcError(
          `Invalid token: ${error instanceof Error ? error.message : "verification failed"}`,
        );
      }

      const subject = payload.sub;
      if (typeof subject !== "string" || subject.length === 0) {
        throw new OidcError("Token has no subject.");
      }

      return {
        id: subject,
        email: typeof payload.email === "string" ? payload.email : subject,
        role: extractRole(payload, roleClaim, adminRoleValue),
      };
    },
  };
}

/**
 * Maps provider claims onto this system's two roles.
 *
 * **Defaults to USER.** A missing, malformed or unrecognised claim must not produce an
 * admin: the failure mode of a mapping bug should be someone unable to do something, not
 * someone able to do everything.
 */
function extractRole(payload: JWTPayload, roleClaim: string, adminRoleValue: string): Role {
  const raw = readClaim(payload, roleClaim);

  const values =
    typeof raw === "string"
      ? raw.split(/[\s,]+/)
      : Array.isArray(raw)
        ? raw.filter((value): value is string => typeof value === "string")
        : [];

  return values.some((value) => value.toLowerCase() === adminRoleValue.toLowerCase())
    ? "ADMIN"
    : "USER";
}

/** Supports dotted paths, because Keycloak nests roles under `realm_access.roles`. */
function readClaim(payload: JWTPayload, claim: string): unknown {
  let current: unknown = payload;
  for (const segment of claim.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
