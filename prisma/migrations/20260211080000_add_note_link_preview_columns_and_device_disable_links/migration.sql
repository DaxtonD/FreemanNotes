-- Add missing columns that are present in schema.prisma but were not previously migrated.

-- Device-scoped preference: disable link clicks on note cards
ALTER TABLE `UserDevicePrefs`
  ADD COLUMN `disableNoteCardLinks` BOOLEAN NULL DEFAULT false;

-- Note-level URL preview summary fields (in addition to NoteLinkPreview rows)
ALTER TABLE `Note`
  ADD COLUMN `linkPreviewUrl` TEXT NULL,
  ADD COLUMN `linkPreviewTitle` TEXT NULL,
  ADD COLUMN `linkPreviewDescription` TEXT NULL,
  ADD COLUMN `linkPreviewImageUrl` TEXT NULL,
  ADD COLUMN `linkPreviewDomain` VARCHAR(191) NULL,
  ADD COLUMN `linkPreviewFetchedAt` DATETIME(3) NULL;
