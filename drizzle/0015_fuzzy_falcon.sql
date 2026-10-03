ALTER TABLE `heygen_tests` ADD `kind` varchar(8) DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE `heygen_tests` ADD `bookTitle` varchar(255);--> statement-breakpoint
ALTER TABLE `heygen_tests` ADD `isPicked` boolean DEFAULT false NOT NULL;