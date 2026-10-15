CREATE TABLE `dub_cta_scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`language` varchar(32) NOT NULL,
	`position` varchar(8) NOT NULL,
	`text` text NOT NULL,
	`english` text,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dub_cta_scripts_id` PRIMARY KEY(`id`),
	CONSTRAINT `dub_cta_scripts_channel_language_position` UNIQUE(`channelKey`,`language`,`position`)
);
