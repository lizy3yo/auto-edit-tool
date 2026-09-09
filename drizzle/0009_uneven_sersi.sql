ALTER TABLE `provider_configs` MODIFY COLUMN `providerType` enum('genaipro','google_gemini','fal_ai','replicate','kie_ai','sixtynine_labs','minimax','custom') NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_configs` ADD `minimaxVoiceId` varchar(128);--> statement-breakpoint
ALTER TABLE `channel_configs` ADD `minimaxVoiceName` varchar(255);