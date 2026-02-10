-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `editorImageThumbSize` INTEGER NULL DEFAULT 115,
  ADD COLUMN `editorImagesExpandedByDefault` BOOLEAN NULL DEFAULT false,
  ADD COLUMN `disableNoteCardLinks` BOOLEAN NULL DEFAULT false;
