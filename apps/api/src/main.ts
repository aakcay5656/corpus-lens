import "reflect-metadata";

/**
 * This entry point is compiled by `tsc` and run with plain `node` — deliberately, and not
 * with `tsx` like the CLIs in this app.
 *
 * NestJS resolves constructor injection from `emitDecoratorMetadata`, and esbuild, which
 * is what `tsx` uses, does not implement it. Under tsx every injected dependency arrives
 * as `undefined` and the first guard throws, so *every* route answers 500. The CLIs are
 * unaffected because they are plain functions with no decorators.
 *
 * Worth stating because the failure is invisible from the test suite: vitest transforms
 * with SWC, which does emit the metadata, so the tests pass against a runtime the server
 * does not have.
 */

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module";
import { setupSwagger } from "./common/swagger";
import { apiEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });

  // Required for the httpOnly auth cookies to be readable at all.
  app.use(cookieParser());

  // A single named origin with credentials enabled. Never "*": the two are incompatible
  // for credentialed CORS by specification, and a wildcard would let any site read an
  // authenticated response (CLAUDE.md §9).
  app.enableCors({ origin: apiEnv.WEB_ORIGIN, credentials: true });

  // Generated from the Zod contracts rather than from decorated DTO classes; see
  // common/swagger.ts. Served at /docs, which CLAUDE.md §3 names as the API documentation
  // deliverable.
  setupSwagger(app, "docs");

  // So DatabaseModule's shutdown hook runs and the connection pool is released; without
  // it the process lingers on SIGINT instead of exiting.
  app.enableShutdownHooks();

  await app.listen(apiEnv.API_PORT);
  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://localhost:${apiEnv.API_PORT}`);
  logger.log(`OpenAPI docs at   http://localhost:${apiEnv.API_PORT}/docs`);
}

void bootstrap();
