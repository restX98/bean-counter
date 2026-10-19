CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`bank` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`anchor_amount` integer,
	`anchor_date` text,
	`anchor_source` text,
	`archived_on` text,
	CONSTRAINT "accounts_type" CHECK("accounts"."type" in ('checking', 'savings')),
	CONSTRAINT "accounts_anchor" CHECK(("accounts"."anchor_amount" is null) = ("accounts"."anchor_date" is null) and ("accounts"."anchor_date" is null) = ("accounts"."anchor_source" is null)),
	CONSTRAINT "accounts_anchor_source" CHECK("accounts"."anchor_source" is null or "accounts"."anchor_source" in ('manual', 'statement'))
);
