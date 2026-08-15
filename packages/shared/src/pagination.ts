import { z } from "zod";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "./limits";

/**
 * Query-string pagination. `coerce` because everything arriving in a URL is a string, and
 * the alternative is every controller parsing integers by hand.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Wraps a page of results. A generic factory rather than a fixed schema, so the item type
 * survives inference instead of collapsing to `unknown`.
 */
export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    /** Total matching rows, not total returned — the UI needs it to render page counts. */
    total: z.number().int(),
  });
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
