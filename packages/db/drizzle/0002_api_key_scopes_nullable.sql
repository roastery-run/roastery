ALTER TABLE "api_keys" ALTER COLUMN "scopes" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "scopes" DROP NOT NULL;