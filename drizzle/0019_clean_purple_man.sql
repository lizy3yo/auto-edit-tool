CREATE TABLE `dub_cta_books` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`language` varchar(32) NOT NULL,
	`title` varchar(255) NOT NULL,
	`coverImageUrl` varchar(512),
	`shopUrl` varchar(512),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dub_cta_books_id` PRIMARY KEY(`id`),
	CONSTRAINT `dub_cta_books_channel_language` UNIQUE(`channelKey`,`language`)
);
--> statement-breakpoint
CREATE TABLE `dub_cta_clips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`language` varchar(32) NOT NULL,
	`position` varchar(8) NOT NULL,
	`status` enum('working','done','failed') NOT NULL DEFAULT 'working',
	`phase` varchar(64),
	`script` text,
	`bookTitle` varchar(255),
	`videoUrl` varchar(512),
	`durationMs` int,
	`error` text,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dub_cta_clips_id` PRIMARY KEY(`id`),
	CONSTRAINT `dub_cta_clips_channel_language_position` UNIQUE(`channelKey`,`language`,`position`)
);
