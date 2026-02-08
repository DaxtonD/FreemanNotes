/*
  Warnings:

  - A unique constraint covering the columns `[userId,noteId,collectionId]` on the table `NoteCollection` will be added. If there are existing duplicate values, this will fail.
  - Made the column `collectionId` on table `NoteCollection` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `NoteCollection` DROP FOREIGN KEY `NoteCollection_collectionId_fkey`;

-- DropIndex
DROP INDEX `NoteCollection_userId_noteId_key` ON `NoteCollection`;

-- AlterTable
ALTER TABLE `NoteCollection` MODIFY `collectionId` INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `NoteCollection_userId_noteId_collectionId_key` ON `NoteCollection`(`userId`, `noteId`, `collectionId`);

-- AddForeignKey
ALTER TABLE `NoteCollection` ADD CONSTRAINT `NoteCollection_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `Collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
