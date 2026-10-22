CREATE TABLE `transfer_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`low` integer NOT NULL,
	`high` integer NOT NULL,
	FOREIGN KEY (`low`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`high`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_dismissals_pair` ON `transfer_dismissals` (`low`,`high`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `transfer_with` integer REFERENCES transactions(id);