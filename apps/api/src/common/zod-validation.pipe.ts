import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { type ZodType } from "zod";

/**
 * Validates a request body against a schema from `packages/shared`.
 *
 * The point is that the schema the browser derives its types from is the same object that
 * rejects the request at runtime (CLAUDE.md §7). Nest's own `ValidationPipe` would mean
 * writing every DTO twice — once as a Zod schema for the client, once as a decorated
 * class for the server — and the two would drift.
 *
 * `parse` also *transforms*: defaults are applied and strings are trimmed, so the
 * controller receives the schema's output type rather than whatever arrived on the wire.
 */
export class ZodValidationPipe<Output> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: ZodType<Output>) {}

  transform(value: unknown): Output {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Field paths and messages only, never the submitted values: a failing login body
    // contains a password, and this text is returned to the client and logged.
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");

    throw new BadRequestException(issues);
  }
}
