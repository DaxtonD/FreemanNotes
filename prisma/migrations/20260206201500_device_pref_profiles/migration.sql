-- CreateTable
CREATE TABLE `UserDeviceProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserDeviceProfile_userId_name_key`(`userId`, `name`),
    INDEX `UserDeviceProfile_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDeviceClient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `deviceKey` VARCHAR(191) NOT NULL,
    `profileId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserDeviceClient_userId_deviceKey_key`(`userId`, `deviceKey`),
    INDEX `UserDeviceClient_profileId_idx`(`profileId`),
    INDEX `UserDeviceClient_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDevicePrefs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profileId` INTEGER NOT NULL,
    `themeChoice` VARCHAR(191) NULL DEFAULT 'system',
    `checklistSpacing` INTEGER NULL,
    `checkboxSize` INTEGER NULL,
    `checklistTextSize` INTEGER NULL,
    `noteLineSpacing` DOUBLE NULL,
    `noteWidth` INTEGER NULL,
    `fontFamily` VARCHAR(191) NULL,
    `dragBehavior` VARCHAR(191) NULL,
    `animationSpeed` VARCHAR(191) NULL,
    `animationBehavior` VARCHAR(191) NULL,
    `animationsEnabled` BOOLEAN NULL DEFAULT true,
    `chipDisplayMode` VARCHAR(191) NULL,
    `imageThumbSize` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserDevicePrefs_profileId_key`(`profileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserDeviceProfile` ADD CONSTRAINT `UserDeviceProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDeviceClient` ADD CONSTRAINT `UserDeviceClient_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDeviceClient` ADD CONSTRAINT `UserDeviceClient_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `UserDeviceProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDevicePrefs` ADD CONSTRAINT `UserDevicePrefs_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `UserDeviceProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
