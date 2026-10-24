CREATE TABLE `payback_dismissals` (
	`transaction_id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
