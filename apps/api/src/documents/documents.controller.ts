import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  documentListQuerySchema,
  type DocumentDetail,
  type DocumentListQuery,
  type DocumentSummary,
} from "@corpus-lens/shared/document";
import { type Paginated } from "@corpus-lens/shared/pagination";

import { Roles } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DocumentsService } from "./documents.service";

/**
 * Admin-only, per CLAUDE.md §9: a `USER` may search and ask, an `ADMIN` additionally
 * manages the corpus. The decorator is on the class, so every route added here inherits
 * it rather than needing to remember.
 *
 * There is a second reason beyond the role split: `errorMessage` on a failed document can
 * contain an absolute server path (an `EACCES` reports the full filesystem path), so these
 * responses are not safe to widen to every authenticated user.
 */
@Controller("documents")
@Roles("ADMIN")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(documentListQuerySchema)) query: DocumentListQuery,
  ): Promise<Paginated<DocumentSummary>> {
    return await this.documents.list(query);
  }

  /**
   * `ParseUUIDPipe` before the service, so a malformed id is a 400 rather than reaching
   * Postgres and coming back as a driver error about invalid uuid syntax.
   */
  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string): Promise<DocumentDetail> {
    return await this.documents.findOne(id);
  }
}
