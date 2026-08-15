import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { type ExecutionContext } from "@nestjs/common";

/**
 * The rate limiter, with a message written for a person.
 *
 * `ThrottlerGuard`'s default exception message is the literal string
 * `"ThrottlerException: Too Many Requests"` — an internal class name rendered into a
 * user-facing error envelope. It leaks nothing dangerous, but it is the same habit that
 * leaks a SQL statement elsewhere: an exception's own text is written for a developer
 * reading a stack trace, not for the client receiving it.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      "Too many requests. Please wait a moment and try again.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
