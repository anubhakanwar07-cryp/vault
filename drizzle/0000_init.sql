CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"role_id" uuid,
	"situation" text,
	"action" text NOT NULL,
	"result" text,
	"metric_value" text,
	"metric_confidence" text DEFAULT 'none' NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"tools" text[] DEFAULT '{}' NOT NULL,
	"function_tags" text[] DEFAULT '{}' NOT NULL,
	"domain_tags" text[] DEFAULT '{}' NOT NULL,
	"seniority_signals" text[] DEFAULT '{}' NOT NULL,
	"raw_notes" text,
	"completeness_score" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"resume_id" uuid,
	"is_tailored" boolean DEFAULT true NOT NULL,
	"applied_at" date,
	"channel" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"institution" text,
	"degree" text,
	"field" text,
	"start_date" date,
	"end_date" date,
	"grade" text,
	"highlights" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "education" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text,
	"title" text,
	"issuer" text,
	"date" date,
	"description" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extras" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company" text,
	"role_title" text,
	"source_url" text,
	"jd_text" text NOT NULL,
	"parsed" jsonb,
	"parsed_raw" jsonb,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pipeline_run_id" uuid,
	"stage" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"input" jsonb,
	"output" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"zod_valid" boolean,
	"retries" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"status" text,
	"stage" text,
	"error" text,
	"total_tokens" integer,
	"total_cost_usd" numeric,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"location" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_role_families" text[] DEFAULT '{}' NOT NULL,
	"base_summary" text,
	"page_limit" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid,
	"name" text NOT NULL,
	"one_liner" text,
	"ownership" text,
	"proof_url" text,
	"is_side_project" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resume_bullets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_id" uuid NOT NULL,
	"achievement_id" uuid,
	"section" text,
	"position" integer,
	"generated_text" text NOT NULL,
	"final_text" text NOT NULL,
	"keywords_used" text[] DEFAULT '{}' NOT NULL,
	"requirements_covered" text[] DEFAULT '{}' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verifier_notes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_bullets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"match_report" jsonb,
	"recruiter_sim" jsonb,
	"pipeline_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resumes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"employment_type" text,
	"company_context" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "style_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "style_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_bullet_id" uuid,
	"before" text,
	"after" text,
	"diff" jsonb,
	"edit_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education" ADD CONSTRAINT "education_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extras" ADD CONSTRAINT "extras_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_rules" ADD CONSTRAINT "style_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_edits" ADD CONSTRAINT "user_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_edits" ADD CONSTRAINT "user_edits_resume_bullet_id_resume_bullets_id_fk" FOREIGN KEY ("resume_bullet_id") REFERENCES "public"."resume_bullets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievements_user_id_index" ON "achievements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "achievements_project_id_index" ON "achievements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "achievements_embedding_idx" ON "achievements" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "applications_user_id_index" ON "applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "education_user_id_index" ON "education" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "extras_user_id_index" ON "extras" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_user_id_index" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_runs_user_id_index" ON "llm_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_runs_pipeline_run_id_index" ON "llm_runs" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_user_id_index" ON "pipeline_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_index" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_role_id_index" ON "projects" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "resume_bullets_resume_id_index" ON "resume_bullets" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "resumes_user_id_index" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resumes_job_id_index" ON "resumes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "roles_user_id_index" ON "roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "style_rules_user_id_index" ON "style_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_edits_user_id_index" ON "user_edits" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "achievements_owner_all" ON "achievements" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "applications_owner_all" ON "applications" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "education_owner_all" ON "education" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "extras_owner_all" ON "extras" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "jobs_owner_all" ON "jobs" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "llm_runs_owner_all" ON "llm_runs" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "pipeline_runs_owner_all" ON "pipeline_runs" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_owner_all" ON "profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "projects_owner_all" ON "projects" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "resume_bullets_owner_all" ON "resume_bullets" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "resumes_owner_all" ON "resumes" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "roles_owner_all" ON "roles" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "style_rules_owner_all" ON "style_rules" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_edits_owner_all" ON "user_edits" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));