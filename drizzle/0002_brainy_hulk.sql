CREATE TABLE `longform_slots` (
	`userId` int NOT NULL,
	`slotIndex` int NOT NULL,
	`jobId` int,
	`draftTitle` varchar(255),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `longform_slots_userId_slotIndex_pk` PRIMARY KEY(`userId`,`slotIndex`)
);
