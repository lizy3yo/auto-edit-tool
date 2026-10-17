CREATE TABLE `dub_cta_broll` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`position` varchar(8) NOT NULL,
	`status` enum('working','done','failed') NOT NULL DEFAULT 'working',
	`pictures` text,
	`error` text,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dub_cta_broll_id` PRIMARY KEY(`id`),
	CONSTRAINT `dub_cta_broll_channel_position` UNIQUE(`channelKey`,`position`)
);
