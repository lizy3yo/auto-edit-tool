CREATE TABLE `channel_host_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`imageUrl` varchar(512) NOT NULL,
	`label` varchar(120),
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_host_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Backfill from the two fixed columns this table supersedes, so every existing channel keeps
-- the angles it already had. Primary first (sortOrder 0), alt second (1) — the same order the
-- pipeline read them in. Run once: the guard is that the table is empty for that channel, so a
-- re-run cannot duplicate rows, and a photo deliberately removed later is not resurrected.
INSERT INTO `channel_host_photos` (`channelKey`, `imageUrl`, `label`, `sortOrder`)
SELECT `channelKey`, `hostPhotoUrl`, 'Primary', 0
FROM `channel_configs`
WHERE `hostPhotoUrl` IS NOT NULL AND `hostPhotoUrl` <> ''
  AND `channelKey` NOT IN (SELECT DISTINCT `channelKey` FROM `channel_host_photos`);
--> statement-breakpoint
INSERT INTO `channel_host_photos` (`channelKey`, `imageUrl`, `label`, `sortOrder`)
SELECT c.`channelKey`, c.`hostPhotoUrl2`, 'Alt angle', 1
FROM `channel_configs` c
WHERE c.`hostPhotoUrl2` IS NOT NULL AND c.`hostPhotoUrl2` <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `channel_host_photos` p
    WHERE p.`channelKey` = c.`channelKey` AND p.`sortOrder` = 1
  );
