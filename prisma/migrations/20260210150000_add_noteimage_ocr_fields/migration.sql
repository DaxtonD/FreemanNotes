-- Add richer OCR fields for NoteImage
ALTER TABLE `NoteImage`
  ADD COLUMN `ocrSearchText` LONGTEXT NULL,
  ADD COLUMN `ocrDataJson` LONGTEXT NULL,
  ADD COLUMN `ocrHash` CHAR(64) NULL,
  ADD COLUMN `ocrAvgConfidence` DOUBLE NULL,
  ADD COLUMN `ocrLang` VARCHAR(16) NULL,
  ADD COLUMN `ocrStatus` VARCHAR(32) NULL DEFAULT 'pending',
  ADD COLUMN `ocrUpdatedAt` DATETIME(3) NULL;

CREATE INDEX `NoteImage_ocrHash_idx` ON `NoteImage`(`ocrHash`);
