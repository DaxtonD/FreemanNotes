-- AlterTable
ALTER TABLE `Note` ADD COLUMN `color` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `NoteItem` ADD COLUMN `indent` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `checkboxBg` VARCHAR(191) NULL,
    ADD COLUMN `checkboxBorder` VARCHAR(191) NULL,
    ADD COLUMN `fontFamily` VARCHAR(191) NULL;
