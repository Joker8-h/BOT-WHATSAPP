-- AlterTable
ALTER TABLE `Order` ADD COLUMN `postSaleStep` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `postSaleNextAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Order_postSaleNextAt_idx` ON `Order`(`postSaleNextAt`);
