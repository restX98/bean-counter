CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match` text NOT NULL,
	`text` text NOT NULL,
	`account_id` integer,
	`amount_currency` text,
	`amount_min` integer,
	`amount_max` integer,
	`category_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rules_match" CHECK("rules"."match" in ('contains', 'regex')),
	CONSTRAINT "rules_amount" CHECK(("rules"."amount_currency" is null) = ("rules"."amount_min" is null and "rules"."amount_max" is null))
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `rule_id` integer REFERENCES rules(id) ON DELETE set null;