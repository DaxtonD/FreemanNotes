-- AlterTable
ALTER TABLE `UserDevicePrefs`
  ADD COLUMN `cardTitleSize` INTEGER NULL,
  ADD COLUMN `cardChecklistSpacing` INTEGER NULL,
  ADD COLUMN `cardCheckboxSize` INTEGER NULL,
  ADD COLUMN `cardChecklistTextSize` INTEGER NULL,
  ADD COLUMN `cardNoteLineSpacing` DOUBLE NULL,
  ADD COLUMN `editorChecklistSpacing` INTEGER NULL,
  ADD COLUMN `editorCheckboxSize` INTEGER NULL,
  ADD COLUMN `editorChecklistTextSize` INTEGER NULL,
  ADD COLUMN `editorNoteLineSpacing` DOUBLE NULL;

-- Backfill from the legacy shared device-pref columns.
UPDATE `UserDevicePrefs`
SET
  cardTitleSize = COALESCE(cardTitleSize, 20),
  cardChecklistSpacing = COALESCE(cardChecklistSpacing, checklistSpacing),
  cardCheckboxSize = COALESCE(cardCheckboxSize, checkboxSize),
  cardChecklistTextSize = COALESCE(cardChecklistTextSize, checklistTextSize),
  cardNoteLineSpacing = COALESCE(cardNoteLineSpacing, noteLineSpacing),
  editorChecklistSpacing = COALESCE(editorChecklistSpacing, checklistSpacing),
  editorCheckboxSize = COALESCE(editorCheckboxSize, checkboxSize),
  editorChecklistTextSize = COALESCE(editorChecklistTextSize, checklistTextSize),
  editorNoteLineSpacing = COALESCE(editorNoteLineSpacing, noteLineSpacing);
