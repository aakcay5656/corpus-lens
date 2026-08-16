import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { type Paginated } from "@corpus-lens/shared/pagination";
import {
  updateUserRoleRequestSchema,
  userListQuerySchema,
  type UpdateUserRoleRequest,
  type UserListQuery,
  type UserSummary,
} from "@corpus-lens/shared/user";

import { CurrentUser, Roles, type AuthenticatedUser } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { UsersService } from "./users.service";

/**
 * Admin-only, like every other management surface.
 *
 * There is no `POST` here: accounts are created through `POST /auth/register`, which is
 * already admin-guarded and already owns password hashing, email normalisation and the
 * duplicate check. The dashboard's "add user" form posts there.
 */
@Controller("users")
@Roles("ADMIN")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery,
  ): Promise<Paginated<UserSummary>> {
    return await this.users.list(query);
  }

  @Patch(":id/role")
  async updateRole(
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserRoleRequestSchema)) body: UpdateUserRoleRequest,
  ): Promise<UserSummary> {
    // The guard guarantees a user; narrowing keeps the non-null assertion out of the code
    // (CLAUDE.md §7) rather than trusting a comment.
    if (actor === undefined) throw new Error("role guard ran without an authenticated user");

    return await this.users.updateRole(actor.id, id, body.role);
  }
}
