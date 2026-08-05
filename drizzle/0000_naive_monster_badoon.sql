CREATE TABLE `app_settings` (
	`key` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `channel_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelKey` varchar(64) NOT NULL,
	`voiceId` varchar(128),
	`voiceName` varchar(255),
	`ttsModel` varchar(64),
	`ttsSpeed` varchar(8),
	`ttsVolume` varchar(8),
	`driveFolderId` varchar(128),
	`driveFolderName` varchar(255),
	`defaultAngle` varchar(32),
	`defaultFormat` varchar(32),
	`defaultWordCount` int,
	`defaultNiche` varchar(64) NOT NULL DEFAULT 'gardening',
	`ideationSheetId` varchar(255),
	`youtubeUrl` varchar(512),
	`youtubeChannelId` varchar(128),
	`displayName` varchar(255),
	`personaProfile` text,
	`nicheSlug` varchar(64),
	`author_name` varchar(255),
	`ctaQrImageUrl` varchar(512),
	`bookCoverImageUrl` varchar(512),
	`hostPhotoUrl` varchar(512),
	`hostPhotoUrl2` varchar(512),
	`hostName` varchar(128),
	`hostTitle` varchar(128),
	`hostLocation` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `channel_configs_channelKey_unique` UNIQUE(`channelKey`)
);
--> statement-breakpoint
CREATE TABLE `channel_layers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel_key` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`layer_content` text NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_layers_id` PRIMARY KEY(`id`),
	CONSTRAINT `channel_layers_channel_key_unique` UNIQUE(`channel_key`)
);
--> statement-breakpoint
CREATE TABLE `longform_video_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(255),
	`status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
	`stage` enum('storyboard','voiceover','clips','assembly','done') NOT NULL DEFAULT 'storyboard',
	`inputParams` json,
	`storyboard` json,
	`progress` json,
	`masterAudioUrl` text,
	`finalVideoUrl` text,
	`finalFileKey` varchar(512),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `longform_video_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`providerType` enum('genaipro','google_gemini','fal_ai','replicate','kie_ai','sixtynine_labs','custom') NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`apiKeyEncrypted` text,
	`apiKeyLast4` varchar(4),
	`customConfig` json,
	`isActive` boolean NOT NULL DEFAULT false,
	`connectionStatus` enum('connected','disconnected','untested') NOT NULL DEFAULT 'untested',
	`lastTestedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_configs_id` PRIMARY KEY(`id`)
);
