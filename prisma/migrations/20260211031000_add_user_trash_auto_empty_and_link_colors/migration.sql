-- Add trash retention + hyperlink colors (user-scoped, across devices)
ALTER TABLE `User`
  ADD COLUMN `trashAutoEmptyDays` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `linkColorDark` VARCHAR(191) NULL DEFAULT '#8ab4f8',
  ADD COLUMN `linkColorLight` VARCHAR(191) NULL DEFAULT '#0b57d0';
