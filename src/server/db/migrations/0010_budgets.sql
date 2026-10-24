CREATE TABLE `budget_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_id` integer NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_limits_amount" CHECK("budget_limits"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_limits_month` ON `budget_limits` (`budget_id`,`month`);--> statement-breakpoint
CREATE TABLE `budget_restarts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_id` integer NOT NULL,
	`month` text NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_restarts_month` ON `budget_restarts` (`budget_id`,`month`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`currency` text NOT NULL,
	`start` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_category` ON `budgets` (`category_id`);