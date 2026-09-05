ALTER TABLE "inventory_reconciliations" ALTER COLUMN "green_lot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD COLUMN "kind" text DEFAULT 'green_ledger' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD COLUMN "roasted_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_roasted_lot_id_roasted_lots_id_fk" FOREIGN KEY ("roasted_lot_id") REFERENCES "public"."roasted_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_recon_open_subject_idx" ON "inventory_reconciliations" USING btree ("org_id",coalesce("green_lot_id", "roasted_lot_id"),"kind") WHERE resolved_at IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_recon_one_subject" CHECK (("inventory_reconciliations"."green_lot_id" is null) <> ("inventory_reconciliations"."roasted_lot_id" is null));