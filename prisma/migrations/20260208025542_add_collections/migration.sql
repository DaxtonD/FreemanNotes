-- DropForeignKey
ALTER TABLE `UserDeviceClient` DROP FOREIGN KEY `UserDeviceClient_profileId_fkey`;

-- DropForeignKey
ALTER TABLE `UserDeviceClient` DROP FOREIGN KEY `UserDeviceClient_userId_fkey`;

-- DropForeignKey
ALTER TABLE `UserDevicePrefs` DROP FOREIGN KEY `UserDevicePrefs_profileId_fkey`;

-- DropForeignKey
ALTER TABLE `UserDeviceProfile` DROP FOREIGN KEY `UserDeviceProfile_userId_fkey`;

-- AlterTable
ALTER TABLE `Note` ADD COLUMN `cardSpan` INTEGER NULL DEFAULT 1,
    ADD COLUMN `yData` LONGBLOB NULL;

-- AlterTable
ALTER TABLE `NoteImage` MODIFY `url` LONGTEXT NOT NULL,
    MODIFY `ocrText` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `chipDisplayMode` VARCHAR(191) NULL DEFAULT 'image+text',
    ADD COLUMN `noteLineSpacing` DOUBLE NULL DEFAULT 1.38,
    ADD COLUMN `userImageUrl` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Collection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `ownerId` INTEGER NOT NULL,
    `parentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Collection_ownerId_idx`(`ownerId`),
    INDEX `Collection_parentId_idx`(`parentId`),
    UNIQUE INDEX `Collection_ownerId_parentId_name_key`(`ownerId`, `parentId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NoteCollection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `noteId` INTEGER NOT NULL,
    `collectionId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NoteCollection_userId_idx`(`userId`),
    INDEX `NoteCollection_noteId_idx`(`noteId`),
    INDEX `NoteCollection_collectionId_idx`(`collectionId`),
    UNIQUE INDEX `NoteCollection_userId_noteId_key`(`userId`, `noteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotePref` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `noteId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `color` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotePref_noteId_idx`(`noteId`),
    INDEX `NotePref_userId_idx`(`userId`),
    UNIQUE INDEX `NotePref_noteId_userId_key`(`noteId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserDeviceProfile` ADD CONSTRAINT `UserDeviceProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDeviceClient` ADD CONSTRAINT `UserDeviceClient_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDeviceClient` ADD CONSTRAINT `UserDeviceClient_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `UserDeviceProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDevicePrefs` ADD CONSTRAINT `UserDevicePrefs_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `UserDeviceProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Collection` ADD CONSTRAINT `Collection_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Collection` ADD CONSTRAINT `Collection_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoteCollection` ADD CONSTRAINT `NoteCollection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoteCollection` ADD CONSTRAINT `NoteCollection_noteId_fkey` FOREIGN KEY (`noteId`) REFERENCES `Note`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoteCollection` ADD CONSTRAINT `NoteCollection_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `Collection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotePref` ADD CONSTRAINT `NotePref_noteId_fkey` FOREIGN KEY (`noteId`) REFERENCES `Note`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotePref` ADD CONSTRAINT `NotePref_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
