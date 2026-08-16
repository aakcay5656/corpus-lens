import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { refreshTokens } from "@corpus-lens/db/schema/refresh-tokens";
import { users } from "@corpus-lens/db/schema/users";
import { type Paginated } from "@corpus-lens/shared/pagination";
import { type Role } from "@corpus-lens/shared/role";
import { type UserListQuery, type UserSummary } from "@corpus-lens/shared/user";
import { and, asc, count, eq, exists, gt, ilike, isNull, ne, sql, type SQL } from "drizzle-orm";

import { DATABASE } from "../database/database.module";

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(query: UserListQuery): Promise<Paginated<UserSummary>> {
    const filters = buildFilters(query);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        // A correlated exists rather than a join, so a user with three live sessions is
        // still one row. A join would multiply the page out and the count would disagree
        // with it.
        //
        // Built with the query builder rather than as a raw `sql` fragment, and that is
        // not a style preference. Interpolating `${users.id}` into a raw string renders it
        // as the bare identifier `"id"`, which inside this subquery resolves to
        // *refresh_tokens*`.id` — a token id compared to a user id. Valid SQL, both uuid,
        // matches nothing, and every account reads as having no session. The builder
        // qualifies both sides.
        hasActiveSession: exists(
          this.db
            .select({ one: sql`1` })
            .from(refreshTokens)
            .where(
              and(
                eq(refreshTokens.userId, users.id),
                isNull(refreshTokens.revokedAt),
                gt(refreshTokens.expiresAt, sql`now()`),
              ),
            ),
        ),
      })
      .from(users)
      .where(where)
      // Oldest first: the seeded demo accounts stay at the top, which is where someone
      // looking for them expects them.
      .orderBy(asc(users.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db.select({ total: count() }).from(users).where(where);

    return {
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
        // Compared rather than cast. `exists()` is typed `SQL<unknown>`, and the Step 9
        // lesson was that a generic on a query result is an assertion, not a check — a
        // `as boolean` here would be believed by the compiler and wrong the day the driver
        // hands back "t".
        hasActiveSession: row.hasActiveSession === true,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: totals?.total ?? 0,
    };
  }

  /**
   * Changes a role, and **revokes that user's refresh tokens in the same breath**.
   *
   * The access token carries the role as a claim and is verified without a database read —
   * that is what makes it cheap enough to put on every request, and it is also why a
   * demotion cannot take effect instantly. Killing the refresh tokens bounds the exposure
   * to one access-token lifetime (15 minutes by default) instead of a week: the old token
   * still works until it expires, but it cannot be exchanged for a new one.
   *
   * Closing the remaining window would mean looking the user up on every request, which
   * trades a permanent cost on every route for a rare event. The MCP server *does* pay it
   * (apps/mcp/src/authenticate.ts), because a token there is held by hand and long-lived.
   */
  async updateRole(actorId: string, targetId: string, role: Role): Promise<UserSummary> {
    if (actorId === targetId) {
      // The classic footgun: an administrator demotes themselves, loses the screen they
      // did it from, and now nobody can undo it without database access.
      throw new ConflictException("You cannot change your own role.");
    }

    const target = await this.db.query.users.findFirst({ where: eq(users.id, targetId) });
    if (target === undefined) throw new NotFoundException("User not found.");

    if (target.role === "ADMIN" && role !== "ADMIN") {
      const [remaining] = await this.db
        .select({ total: count() })
        .from(users)
        .where(and(eq(users.role, "ADMIN"), ne(users.id, targetId)));

      // Zero admins is an unrecoverable state through the UI — registration is admin-only,
      // so there would be no way back in without touching the database.
      if ((remaining?.total ?? 0) === 0) {
        throw new BadRequestException("There must be at least one administrator.");
      }
    }

    const [updated] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, targetId))
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      });

    if (updated === undefined) throw new NotFoundException("User not found.");

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, targetId), isNull(refreshTokens.revokedAt)));

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      hasActiveSession: false,
    };
  }
}

function buildFilters(query: UserListQuery): SQL[] {
  const filters: SQL[] = [];

  if (query.search !== undefined && query.search.length > 0) {
    // Bound as a parameter with the wildcards supplied here; the metacharacters in the
    // term are escaped so that searching for "%" filters rather than matching everything.
    filters.push(ilike(users.email, `%${escapeLike(query.search)}%`));
  }
  if (query.role !== undefined) filters.push(eq(users.role, query.role));

  return filters;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
