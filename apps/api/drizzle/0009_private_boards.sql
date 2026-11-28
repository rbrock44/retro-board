CREATE TABLE "board_access" (
	"board_id" text NOT NULL,
	"user_id" text NOT NULL,
	"link_version" integer,
	"password_version" integer,
	CONSTRAINT "board_access_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "link_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "password_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_access" ADD CONSTRAINT "board_access_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_access" ADD CONSTRAINT "board_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_access_user_idx" ON "board_access" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_share_token_unique" UNIQUE("share_token");