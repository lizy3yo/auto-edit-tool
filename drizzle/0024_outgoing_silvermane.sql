ALTER TABLE `channel_host_photos` ADD `qualityScore` int;--> statement-breakpoint
ALTER TABLE `channel_host_photos` ADD `qualityNotes` varchar(255);--> statement-breakpoint
ALTER TABLE `channel_host_photos` ADD `qualityOf` varchar(512);--> statement-breakpoint
ALTER TABLE `channel_host_photos` ADD `pickedByHand` boolean DEFAULT false NOT NULL;