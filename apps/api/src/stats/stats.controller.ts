import { Controller, Get, Query } from "@nestjs/common";
import { type StatsResponse } from "@corpus-lens/shared/stats";
import { z } from "zod";

import { Roles } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { StatsService } from "./stats.service";

/**
 * The window is bounded, not free-form. `?windowDays=100000` would scan the whole table
 * and compute percentiles over it — cheap to type, expensive to serve, and exactly the
 * kind of unbounded input CLAUDE.md §9 says to reject.
 */
const statsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});

@Controller("stats")
@Roles("ADMIN")
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  async summary(
    @Query(new ZodValidationPipe(statsQuerySchema)) query: { windowDays: number },
  ): Promise<StatsResponse> {
    return await this.stats.summary(query.windowDays);
  }
}
