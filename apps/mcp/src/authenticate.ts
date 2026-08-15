import { type Database } from "@corpus-lens/db/client";
import { users } from "@corpus-lens/db/schema/users";
import { type Role } from "@corpus-lens/shared/role";
import { eq } from "drizzle-orm";
import { type Request } from "express";
import jwt from "jsonwebtoken";

import { mcpEnv } from "./env";

/**
 * Authenticating an MCP caller.
 *
 * CLAUDE.md §9: "The MCP server authenticates callers too — it is a second front door to
 * the same data, and leaving it open would undo the auth work on the API." Everything the
 * REST API protects is reachable through these tools, so an unauthenticated MCP endpoint
 * would make the guards, the roles and the cookie flags on the API decorative.
 *
 * Two checks, not one:
 *
 * 1. **The signature**, against the same `JWT_ACCESS_SECRET` the API signs with. This is
 *    what "validated against the same user store" means concretely — there is no second
 *    credential system to keep in sync, and a token this server accepts is exactly a
 *    token the API would accept.
 * 2. **The user still exists**, by id. A JWT is a bearer credential that cannot be
 *    withdrawn before it expires; looking the subject up means a deleted account stops
 *    working immediately rather than fifteen minutes later. The API can skip this because
 *    its access tokens are short-lived and its refresh flow is where revocation bites;
 *    an MCP client holds a token by hand, so the check is worth one query.
 */
export interface McpCaller {
  id: string;
  email: string;
  role: Role;
}

export class UnauthenticatedError extends Error {}

export async function authenticate(request: Request, db: Database): Promise<McpCaller> {
  const token = extractBearerToken(request);
  if (token === undefined) {
    throw new UnauthenticatedError("Missing bearer token.");
  }

  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, mcpEnv.JWT_ACCESS_SECRET);
    if (typeof verified === "string") throw new UnauthenticatedError("Malformed token.");
    payload = verified;
  } catch {
    // Expired, tampered with, or signed with a different key — one answer for all three.
    // Distinguishing them tells a caller whether a token is stale or forged.
    throw new UnauthenticatedError("Invalid or expired token.");
  }

  const subject = payload.sub;
  if (typeof subject !== "string") throw new UnauthenticatedError("Invalid token.");

  const user = await db.query.users.findFirst({ where: eq(users.id, subject) });
  if (user === undefined) throw new UnauthenticatedError("Invalid token.");

  // The role comes from the database row, not from the token's claim. They agree today,
  // but the row is the authority: a user demoted after their token was issued must not
  // keep the old role until it expires.
  return { id: user.id, email: user.email, role: user.role };
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.header("authorization");
  if (header === undefined) return undefined;

  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value !== undefined && value.length > 0
    ? value
    : undefined;
}
