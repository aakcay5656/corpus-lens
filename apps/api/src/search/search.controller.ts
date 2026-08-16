import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  answerRequestSchema,
  type AnswerRequest,
  type AnswerResponse,
} from "@corpus-lens/shared/answer";
import {
  searchRequestSchema,
  type SearchRequest,
  type SearchResponse,
} from "@corpus-lens/shared/search";
import { type Request, type Response } from "express";

import { CurrentUser, type AuthenticatedUser } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SearchService } from "./search.service";

/**
 * Search and answering. Authenticated, any role — CLAUDE.md §9 gives `USER` the right to
 * search and ask; only the corpus-management routes are admin-only.
 *
 * Both routes carry a **stricter rate limit** than the global default. They are the two
 * endpoints that cost money per call: each one embeds the query, and `/answer` also runs a
 * generation. An unbounded caller here is a denial-of-service against the bill rather than
 * against the server, which is why `topK` is bounded by the shared schema *and* the number
 * of requests is bounded here.
 */
@Controller()
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly search: SearchService) {}

  @Post("search")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async searchCorpus(
    @Body(new ZodValidationPipe(searchRequestSchema)) body: SearchRequest,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<SearchResponse> {
    return await this.search.search(body, requireUser(user).id);
  }

  /**
   * Streams the answer as Server-Sent Events.
   *
   * Written against the raw `Response` rather than Nest's `@Sse()` decorator, because
   * `@Sse()` expects an Observable of events and this needs two different event *kinds*:
   * `token` frames as the model produces them, then one `result` frame carrying the
   * validated citations, the sources and the timings. The citations cannot be sent with
   * the tokens — they only exist after the complete text has been validated against the
   * supplied context.
   */
  @Post("answer")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async answer(
    @Body(new ZodValidationPipe(answerRequestSchema)) body: AnswerRequest,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const userId = requireUser(user).id;

    // Before a single header goes out: once the stream starts the status is 200 and the
    // exception filter is powerless, so a 503 for an unconfigured chat provider has to be
    // raised while a normal error response is still possible.
    this.search.assertAnswerAvailable();

    response.setHeader("content-type", "text/event-stream");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    // Proxies that buffer will hold the whole stream and defeat the point.
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders();

    // If the browser navigates away mid-generation there is nobody to write to; writing
    // to a destroyed socket throws and would surface as an unhandled rejection.
    let clientGone = false;
    request.on("close", () => {
      clientGone = true;
    });

    const send = (event: string, data: unknown): void => {
      if (clientGone) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.search.answer(body, userId, (token) => {
        send("token", { token });
      });

      const payload: AnswerResponse = {
        question: result.question,
        answered: result.answered,
        text: result.text,
        citations: result.citations,
        sources: result.sources,
        abstainReason: result.abstainReason,
        answerMode: result.answerMode,
        timings: result.timings,
      };
      send("result", payload);
    } catch (error) {
      // The stream already has a 200 status, so the exception filter cannot help here —
      // headers are long gone. The error is delivered as an event instead, in the same
      // sanitised shape, and the message is never the raw exception text.
      send("error", {
        error: {
          // UPSTREAM_UNAVAILABLE rather than INTERNAL when a provider is the cause. The
          // server is fine; a dependency is not, and search keeps working — which is a
          // materially different thing to tell a user.
          code:
            error instanceof HttpException && error.getStatus() === 502
              ? "UPSTREAM_UNAVAILABLE"
              : "INTERNAL",
          message:
            error instanceof HttpException && error.getStatus() === 502
              ? "The answer service is temporarily unavailable. Search is unaffected."
              : "The answer could not be generated.",
          requestId: request.requestId,
        },
      });

      // Deliberately **not** rethrown.
      //
      // Rethrowing hands the error to Nest's exception filter, which calls
      // `response.status().json()` — on a response whose headers went out with the first
      // token. Express then throws ERR_HTTP_HEADERS_SENT, the original cause is buried
      // under it, and the client receives a truncated stream instead of the error frame it
      // was just sent. This was latent from the moment the endpoint was written and only
      // surfaced when a provider first failed *mid-stream* rather than before it.
      //
      // The client has been told through the stream; the operator is told through the log.
      this.logger.error(
        `answer stream failed [${request.requestId}]: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      if (!clientGone) response.end();
    }
  }
}

/**
 * The guards guarantee a user on these routes, but the type does not — `request.user` is
 * optional because `@Public()` routes exist. Narrowing here keeps the non-null assertion
 * out of the code (CLAUDE.md §7) and fails loudly if a guard is ever removed.
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (user === undefined) throw new UnauthorizedException("Authentication required.");
  return user;
}
