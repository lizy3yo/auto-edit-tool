CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(128) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`role` enum('admin','manager','editor') NOT NULL DEFAULT 'editor',
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`lastLoginAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
