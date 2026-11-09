CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vote_rounds" (
	"meeting_id" uuid NOT NULL,
	"vote_id" integer NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_rounds_meeting_id_vote_id_pk" PRIMARY KEY("meeting_id","vote_id")
);
--> statement-breakpoint
DROP INDEX "join_requests_active_wallet_unique";--> statement-breakpoint
ALTER TABLE "join_requests" ADD COLUMN "is_voter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vote_rounds" ADD CONSTRAINT "vote_rounds_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "join_requests_active_wallet_unique" ON "join_requests" USING btree ("meeting_id","wallet_address") WHERE "join_requests"."status" in ('PENDING_HOST_APPROVAL', 'ADMITTED');