import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { DatabaseModule } from "./database/database.module";

/**
 * Both guards are registered **globally**, and that is the security decision of this step.
 *
 * CLAUDE.md §9: "Authorization is enforced server-side on every route." Applying
 * `@UseGuards(JwtAuthGuard)` per controller would satisfy that only for as long as nobody
 * forgets — and the endpoints in Step 9 (`/search`, `/answer`, `/documents`, `/ingest`,
 * `/stats`) are exactly where forgetting would be easy and invisible. Registered here,
 * the default for any new route is "authenticated", and exposing one takes a deliberate
 * `@Public()`.
 *
 * Order matters: Nest runs global guards in registration order, so authentication resolves
 * `request.user` before authorization reads its role.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including the ones that fail: the error envelope quotes a request id,
    // so the id has to exist before anything can go wrong.
    consumer.apply(RequestIdMiddleware).forRoutes("*path");
  }
}
