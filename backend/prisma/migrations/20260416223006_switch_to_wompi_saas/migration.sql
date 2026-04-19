/*
  Warnings:

  - You are about to drop the column `stripePublishableKey` on the `branch` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSecretKey` on the `branch` table. All the data in the column will be lost.
  - You are about to drop the column `stripeWebhookSecret` on the `branch` table. All the data in the column will be lost.
  - You are about to drop the column `paymentUrl` on the `order` table. All the data in the column will be lost.
  - You are about to drop the column `stripePaymentId` on the `order` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSessionId` on the `order` table. All the data in the column will be lost.
  - You are about to drop the column `stripePriceId` on the `product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `branch` DROP COLUMN `stripePublishableKey`,
    DROP COLUMN `stripeSecretKey`,
    DROP COLUMN `stripeWebhookSecret`,
    ADD COLUMN `notificationGroupName` VARCHAR(200) NULL,
    ADD COLUMN `wompiIntegritySecret` TEXT NULL,
    ADD COLUMN `wompiMerchantId` VARCHAR(100) NULL,
    ADD COLUMN `wompiPrivateKey` TEXT NULL,
    ADD COLUMN `wompiPublicKey` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `order` DROP COLUMN `paymentUrl`,
    DROP COLUMN `stripePaymentId`,
    DROP COLUMN `stripeSessionId`,
    ADD COLUMN `wompiPaymentLink` VARCHAR(500) NULL,
    ADD COLUMN `wompiTransactionId` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `product` DROP COLUMN `stripePriceId`,
    ADD COLUMN `wompiPaymentLink` VARCHAR(500) NULL;
