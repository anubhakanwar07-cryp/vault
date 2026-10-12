CREATE TABLE "vault_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"url" text,
	"file_path" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vault_sources" ADD CONSTRAINT "vault_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_sources_user_id_index" ON "vault_sources" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "vault_sources_owner_all" ON "vault_sources" AS PERMISSIVE FOR ALL TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vault_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
