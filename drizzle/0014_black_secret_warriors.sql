ALTER TABLE `channel_host_photos` ADD `phoneImageUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `channel_host_photos` ADD `useOriginal` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_host_photos` ADD `phoneLookError` varchar(255);