CREATE TABLE `paybacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`expense_id` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expense_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "paybacks_amount" CHECK("paybacks"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paybacks_pair` ON `paybacks` (`payment_id`,`expense_id`);--> statement-breakpoint
CREATE INDEX `paybacks_expense` ON `paybacks` (`expense_id`);