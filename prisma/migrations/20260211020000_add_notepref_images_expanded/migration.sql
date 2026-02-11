-- Add note-card per-user preference for image preview expansion
ALTER TABLE `NotePref`
  ADD COLUMN `imagesExpanded` BOOLEAN NOT NULL DEFAULT false;
