import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { type ErrorCode, type ErrorEnvelope } from "@corpus-lens/shared/error";
import { type Request, type Response } from "express";

/**
 * The one place a failure becomes a response.
 *
 * CLAUDE.md §7 requires a single error shape and forbids leaking a stack trace, a SQL
 * string or a provider error body to the client. The rule this filter enforces is
 * stricter than "sanitise the message": an unrecognised exception's message is **never**
 * used at all. There is no way to be sure what an arbitrary `Error.message` contains —
 * the ingestion pipeline already proved that in Step 5, where the ORM's message was the
 * entire failed statement, and again in Step 6, where a provider echoed back an API key.
 *
 * So only exceptions this code raised on purpose (`HttpException`) speak to the client.
 * Everything else becomes a flat "internal error" plus the request id, and the real cause
 * goes to the server log where it belongs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = request.requestId ?? "unknown";

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? extractMessage(exception)
        : "An internal error occurred.";

    if (!(exception instanceof HttpException)) {
      // Logged with the stack, on the server, correlated by request id. This is the half
      // of the error the client never sees.
      this.logger.error(
        `${request.method} ${request.url} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorEnvelope = {
      error: { code: toErrorCode(status), message, requestId },
    };

    response.status(status).json(body);
  }
}

/**
 * Nest's HttpException carries either a string or an object response. Only the string
 * form and a `message` field are read, and an array of validation messages is joined —
 * anything else is replaced with the status text rather than serialised blindly.
 */
function extractMessage(exception: HttpException): string {
  const payload: unknown = exception.getResponse();
  if (typeof payload === "string") return payload;

  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message: unknown = (payload as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === "string").join("; ");
  }

  return exception.message;
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.BAD_GATEWAY]: "UPSTREAM_UNAVAILABLE",
  [HttpStatus.SERVICE_UNAVAILABLE]: "UPSTREAM_UNAVAILABLE",
  [HttpStatus.GATEWAY_TIMEOUT]: "UPSTREAM_UNAVAILABLE",
};

function toErrorCode(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? "INTERNAL";
}
