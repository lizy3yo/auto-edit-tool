CREATE TABLE `heygen_tests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(32) NOT NULL,
	`userId` int NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`ttsVendor` varchar(16) NOT NULL,
	`heygenSlot` int,
	`imageUrl` varchar(512) NOT NULL,
	`script` text NOT NULL,
	`audioUrl` varchar(512),
	`audioMs` int,
	`videoId` varchar(128),
	`videoUrl` varchar(512),
	`status` enum('voicing','rendering','done','failed') NOT NULL DEFAULT 'voicing',
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `heygen_tests_id` PRIMARY KEY(`id`)
);
