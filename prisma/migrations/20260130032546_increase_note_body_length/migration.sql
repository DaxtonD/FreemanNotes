-- AlterTable
ALTER TABLE `Invite` ADD COLUMN `desiredRole` VARCHAR(191) NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE `Note` ADD COLUMN `ord` INTEGER NOT NULL DEFAULT 0,
    MODIFY `body` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `animationSpeed` VARCHAR(191) NULL DEFAULT 'normal',
    ADD COLUMN `checkboxSize` INTEGER NULL DEFAULT 20,
    ADD COLUMN `checklistSpacing` INTEGER NULL DEFAULT 15,
    ADD COLUMN `checklistTextSize` INTEGER NULL DEFAULT 17,
    ADD COLUMN `dragBehavior` VARCHAR(191) NULL DEFAULT 'swap',
    ADD COLUMN `noteWidth` INTEGER NULL DEFAULT 288,
    MODIFY `fontFamily` VARCHAR(191) NULL DEFAULT 'Calibri, system-ui, Arial, sans-serif';
