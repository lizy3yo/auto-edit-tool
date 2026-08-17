CREATE TABLE `books` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`coverImageUrl` varchar(512),
	`shopUrl` varchar(512),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `books_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `longform_sales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalOrderId` varchar(128) NOT NULL,
	`ref` varchar(64),
	`jobId` int,
	`productId` varchar(128),
	`bookId` int,
	`amountCents` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `longform_sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `longform_sales_externalOrderId_unique` UNIQUE(`externalOrderId`)
);
--> statement-breakpoint
ALTER TABLE `longform_video_jobs` ADD `youtubeUrl` varchar(512);