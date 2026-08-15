import { type INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { answerRequestSchema, answerResponseSchema } from "@corpus-lens/shared/answer";
import {
  loginRequestSchema,
  registerRequestSchema,
  sessionResponseSchema,
} from "@corpus-lens/shared/auth";
import { documentDetailSchema, documentSummarySchema } from "@corpus-lens/shared/document";
import { errorEnvelopeSchema } from "@corpus-lens/shared/error";
import {
  ingestRequestSchema,
  ingestionRunDetailSchema,
  ingestionRunSchema,
} from "@corpus-lens/shared/ingestion";
import { searchRequestSchema, searchResponseSchema } from "@corpus-lens/shared/search";
import { statsResponseSchema } from "@corpus-lens/shared/stats";
import { z, type ZodType } from "zod";

/**
 * OpenAPI generated from the same Zod schemas that validate requests at runtime.
 *
 * `@nestjs/swagger` normally builds its schemas from decorated DTO classes, which would
 * mean describing every payload twice — once as a Zod schema for the contract and the
 * client, once as a class for the docs — and the two would drift the first time one was
 * edited alone. Zod 4 emits JSON Schema natively (`z.toJSONSchema`), so the documentation
 * is derived from the validator instead of maintained alongside it, and no additional
 * dependency is needed to bridge them.
 */
const SCHEMAS: Record<string, ZodType> = {
  LoginRequest: loginRequestSchema,
  RegisterRequest: registerRequestSchema,
  SessionResponse: sessionResponseSchema,
  SearchRequest: searchRequestSchema,
  SearchResponse: searchResponseSchema,
  AnswerRequest: answerRequestSchema,
  AnswerResponse: answerResponseSchema,
  DocumentSummary: documentSummarySchema,
  DocumentDetail: documentDetailSchema,
  IngestRequest: ingestRequestSchema,
  IngestionRun: ingestionRunSchema,
  IngestionRunDetail: ingestionRunDetailSchema,
  StatsResponse: statsResponseSchema,
  ErrorEnvelope: errorEnvelopeSchema,
};

export function setupSwagger(app: INestApplication, path: string): void {
  const config = new DocumentBuilder()
    .setTitle("corpus-lens API")
    .setDescription(
      "Semantic search and grounded RAG answers over a Markdown corpus.\n\n" +
        "Every route requires authentication except `POST /auth/login`, `POST /auth/refresh` " +
        "and `POST /auth/logout`. The browser authenticates with httpOnly cookies set by " +
        "login; non-browser clients may send `Authorization: Bearer <access token>`.\n\n" +
        "`/documents`, `/ingest` and `/stats` additionally require the ADMIN role.",
    )
    .setVersion("0.1.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
    .addCookieAuth("cl_access", { type: "apiKey", in: "cookie", name: "cl_access" }, "cookie")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  document.components ??= {};
  document.components.schemas = { ...(document.components.schemas ?? {}), ...buildSchemas() };

  SwaggerModule.setup(path, app, document);
}

function buildSchemas(): Record<string, Record<string, unknown>> {
  const schemas: Record<string, Record<string, unknown>> = {};

  for (const [name, schema] of Object.entries(SCHEMAS)) {
    // `io: "input"` describes what a client may send. Defaults are optional on the way in
    // and present on the way out, so documenting the output shape as a request body would
    // tell callers to send fields the server fills in for them.
    schemas[name] = z.toJSONSchema(schema, { io: "input", target: "draft-7" }) as Record<
      string,
      unknown
    >;
  }

  return schemas;
}
