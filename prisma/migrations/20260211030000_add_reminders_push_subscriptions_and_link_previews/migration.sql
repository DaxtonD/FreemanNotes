-- Add reminder + trash columns used by reminderPushJob and note lifecycle
ALTER TABLE `Note`
  ADD COLUMN `trashedAt` DATETIME(3) NULL,
  ADD COLUMN `reminderDueAt` DATETIME(3) NULL,
  ADD COLUMN `reminderOffsetMinutes` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `reminderAt` DATETIME(3) NULL,
  ADD COLUMN `reminderNotifiedAt` DATETIME(3) NULL;

CREATE INDEX `Note_ownerId_trashedAt_idx` ON `Note`(`ownerId`, `trashedAt`);
CREATE INDEX `Note_ownerId_reminderAt_idx` ON `Note`(`ownerId`, `reminderAt`);
CREATE INDEX `Note_ownerId_reminderDueAt_idx` ON `Note`(`ownerId`, `reminderDueAt`);

-- CreateTable
CREATE TABLE `PushSubscription` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `deviceKey` VARCHAR(128) NULL,
  `endpointHash` CHAR(64) NOT NULL,
  `endpoint` LONGTEXT NOT NULL,
  `p256dh` LONGTEXT NOT NULL,
  `auth` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PushSubscription_userId_endpointHash_key`(`userId`, `endpointHash`),
  INDEX `PushSubscription_userId_idx`(`userId`),
  INDEX `PushSubscription_deviceKey_idx`(`deviceKey`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NoteLinkPreview` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `noteId` INTEGER NOT NULL,
  `urlHash` CHAR(64) NOT NULL,
  `url` TEXT NOT NULL,
  `title` TEXT NULL,
  `description` TEXT NULL,
  `imageUrl` TEXT NULL,
  `domain` VARCHAR(191) NULL,
  `fetchedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `NoteLinkPreview_noteId_urlHash_key`(`noteId`, `urlHash`),
  INDEX `NoteLinkPreview_noteId_idx`(`noteId`),
  INDEX `NoteLinkPreview_urlHash_idx`(`urlHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoteLinkPreview` ADD CONSTRAINT `NoteLinkPreview_noteId_fkey`
  FOREIGN KEY (`noteId`) REFERENCES `Note`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
