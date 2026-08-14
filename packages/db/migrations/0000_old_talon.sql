CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'INDEXED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ingestion_level" AS ENUM('INFO', 'WARN', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."ingestion_phase" AS ENUM('DISCOVER', 'PARSE', 'CHUNK', 'EMBED', 'PERSIST');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ingestion_trigger" AS ENUM('CLI', 'API', 'WATCH', 'SCHEDULE');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"breadcrumb" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(breadcrumb, '') || ' ' || coalesce(content, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_path" text NOT NULL,
	"title" text NOT NULL,
	"content_hash" text NOT NULL,
	"doc_type" text,
	"doc_date" date,
	"subject" text,
	"version" text,
	"lifecycle" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"token_count" integer,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_source_path_unique" UNIQUE("source_path")
);
--> statement-breakpoint
CREATE TABLE "ingestion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid,
	"source_path" text,
	"phase" "ingestion_phase" NOT NULL,
	"level" "ingestion_level" DEFAULT 'INFO' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corpus_dir" text NOT NULL,
	"trigger" "ingestion_trigger" NOT NULL,
	"status" "ingestion_run_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"documents_added" integer DEFAULT 0 NOT NULL,
	"documents_updated" integer DEFAULT 0 NOT NULL,
	"documents_removed" integer DEFAULT 0 NOT NULL,
	"documents_failed" integer DEFAULT 0 NOT NULL,
	"documents_unchanged" integer DEFAULT 0 NOT NULL,
	"chunks_written" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"query_text" text NOT NULL,
	"endpoint" text NOT NULL,
	"top_k" integer NOT NULL,
	"embed_ms" integer,
	"retrieve_ms" integer,
	"generate_ms" integer,
	"total_ms" integer NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"top_score" real,
	"answered" boolean DEFAULT true NOT NULL,
	"chunk_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_document_ordinal_unique" ON "chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_search_vector_gin_idx" ON "chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_doc_type_idx" ON "documents" USING btree ("doc_type");--> statement-breakpoint
CREATE INDEX "ingestion_events_run_id_created_at_idx" ON "ingestion_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "ingestion_events_level_idx" ON "ingestion_events" USING btree ("level");--> statement-breakpoint
CREATE INDEX "ingestion_runs_started_at_idx" ON "ingestion_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_queries_created_at_idx" ON "search_queries" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_queries_answered_idx" ON "search_queries" USING btree ("answered");