-- AlterTable
ALTER TABLE `UserDevicePrefs`
  ADD COLUMN `editorImageThumbSize` INTEGER NULL DEFAULT 115,
  ADD COLUMN `editorImagesExpandedByDefault` BOOLEAN NULL DEFAULT false;

-- Backfill from mistakenly-added user-scoped columns (if present in your DB at this point).
UPDATE `UserDevicePrefs` udp
JOIN `UserDeviceProfile` up ON up.id = udp.profileId
JOIN `User` u ON u.id = up.userId
SET
  udp.editorImageThumbSize = COALESCE(udp.editorImageThumbSize, u.editorImageThumbSize),
  udp.editorImagesExpandedByDefault = COALESCE(udp.editorImagesExpandedByDefault, u.editorImagesExpandedByDefault);

-- Remove the mistaken user-scoped columns.
ALTER TABLE `User`
  DROP COLUMN `editorImageThumbSize`,
  DROP COLUMN `editorImagesExpandedByDefault`;
