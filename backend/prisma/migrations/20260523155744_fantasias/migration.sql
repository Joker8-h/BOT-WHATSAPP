/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `Contact_phone_branchId_key` ON `contact`;

-- AlterTable
ALTER TABLE `branch` ADD COLUMN `supportedCities` TEXT NULL,
    MODIFY `phone` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `contact` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `fullName` VARCHAR(200) NULL,
    ADD COLUMN `interests` TEXT NULL,
    MODIFY `phone` VARCHAR(50) NOT NULL;

-- CreateTable
CREATE TABLE `SyncSource` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `type` VARCHAR(50) NOT NULL DEFAULT 'GOOGLE_DRIVE',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSyncAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(255) NULL,
    `branchId` INTEGER NOT NULL,
    `config` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SyncSource_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeAccess` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NULL,
    `branchId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmployeeAccess_branchId_idx`(`branchId`),
    UNIQUE INDEX `EmployeeAccess_phone_branchId_key`(`phone`, `branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Contact_phone_key` ON `Contact`(`phone`);

-- AddForeignKey
ALTER TABLE `SyncSource` ADD CONSTRAINT `SyncSource_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeAccess` ADD CONSTRAINT `EmployeeAccess_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
