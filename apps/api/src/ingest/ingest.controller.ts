import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ingestRequestSchema,
  ingestionRunListQuerySchema,
  type IngestRequest,
  type IngestionRun,
  type IngestionRunDetail,
  type IngestionRunListQuery,
} from "@corpus-lens/shared/ingestion";
import { type Paginated } from "@corpus-lens/shared/pagination";

import { Roles } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { IngestService } from "./ingest.service";

/**
 * Admin-only. Triggering a re-index is both expensive and destructive-ish — it replaces
 * every document's chunks — so it sits behind the same role as corpus management.
 *
 * Note what the request body cannot contain: a corpus directory. Accepting one would let
 * an authenticated admin point ingestion at any path the API process can read, which is
 * path traversal presented as a feature. The directory comes from `CORPUS_DIR` on the
 * server (packages/shared/src/ingestion.ts, CLAUDE.md §5).
 */
@Controller("ingest")
@Roles("ADMIN")
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /**
   * 202 Accepted, not 201. The run has been *started*, not finished — a full pass takes
   * about a minute against a hosted embedding model, and the response is the handle for
   * polling rather than the result.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger(
    @Body(new ZodValidationPipe(ingestRequestSchema)) body: IngestRequest,
  ): Promise<IngestionRun> {
    return await this.ingest.start(body.force);
  }

  @Get("runs")
  async listRuns(
    @Query(new ZodValidationPipe(ingestionRunListQuerySchema)) query: IngestionRunListQuery,
  ): Promise<Paginated<IngestionRun>> {
    return await this.ingest.listRuns(query);
  }

  @Get("runs/:id")
  async findRun(@Param("id", ParseUUIDPipe) id: string): Promise<IngestionRunDetail> {
    return await this.ingest.findRun(id);
  }
}
