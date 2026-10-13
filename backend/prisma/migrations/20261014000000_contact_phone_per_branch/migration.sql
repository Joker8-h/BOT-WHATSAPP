-- Teléfono único POR SEDE (multi-tenant real).
-- Seguro: todo dato que cumplía unique(phone) cumple unique(phone, branchId).
-- Backfill de branchId NULL a la sede maestra para que el unique cubra todas las filas.
UPDATE `Contact` SET `branchId` = 1 WHERE `branchId` IS NULL;

DROP INDEX `Contact_phone_key` ON `Contact`;
CREATE UNIQUE INDEX `Contact_phone_branchId_key` ON `Contact`(`phone`, `branchId`);
