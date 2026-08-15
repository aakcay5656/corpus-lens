import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";
import { type NextFunction, type Request, type Response } from "express";

/**
 * Gives every request an id, echoed in the response header and in the error envelope.
 *
 * This is what makes the error contract workable. `ErrorEnvelope` deliberately has no
 * `details` or `stack` field (CLAUDE.md §7), so the client is told very little — the
 * request id is the handle a user can quote and an operator can grep, and it is the only
 * bridge between a sanitised client-facing message and the real cause in the server log.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    // An inbound header is accepted so a request can be traced across services, but it is
    // bounded and stripped of anything but safe characters: it is attacker-controlled and
    // ends up in log lines and a response header, where a newline would let it forge an
    // extra header or a fake log entry.
    const inbound = request.header("x-request-id");
    const requestId = sanitise(inbound) ?? randomUUID();

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}

function sanitise(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : undefined;
}
