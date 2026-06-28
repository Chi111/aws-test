CREATE TYPE "public"."admin_role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "admin_role" DEFAULT 'viewer' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "github_profile_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" varchar(64) NOT NULL,
	"field_key" varchar(80) NOT NULL,
	"field_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_profiles" (
	"github_id" varchar(64) PRIMARY KEY NOT NULL,
	"login" varchar(120) NOT NULL,
	"name" varchar(255),
	"avatar_url" text,
	"html_url" text NOT NULL,
	"public_repos" integer DEFAULT 0 NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"following" integer DEFAULT 0 NOT NULL,
	"github_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_profiles_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "github_profile_fields" ADD CONSTRAINT "github_profile_fields_github_id_github_profiles_github_id_fk" FOREIGN KEY ("github_id") REFERENCES "public"."github_profiles"("github_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_profile_fields_profile_key_unique" ON "github_profile_fields" USING btree ("github_id","field_key");