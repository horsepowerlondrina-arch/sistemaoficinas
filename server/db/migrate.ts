import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
export function migrate(db: DatabaseSync) {
  for (const [version, file] of [
    [2, "002-workflows.sql"],
    [3, "003-real-workshop.sql"],
    [4, "004-expense-month.sql"],
    [5, "005-service-consolidation.sql"],
    [6, "006-cloud-access.sql"],
    [7, "007-extension.sql"],
    [8, "008-extension-catalog.sql"],
    [9, "009-catalog-stock-pricing.sql"],
    [10, "010-capture-freight-total.sql"],
    [11, "011-reusable-order-share.sql"],
    [12, "012-vehicle-entry-checklists.sql"],
    [13, "013-checklist-plate-first.sql"],
    [14, "014-cash-control-recurring.sql"],
    [15, "015-product-categories.sql"],
    [16, "016-product-identity.sql"],
    [17, "017-credit-card-settlement.sql"],
    [18, "018-stock-invoices.sql"],
    [19, "019-suppliers.sql"],
    [20, "020-workshop-profile.sql"],
    [21, "021-vehicle-fipe.sql"],
    [22, "022-repair-services.sql"],
    [23, "023-workshop-customization.sql"],
    [24, "024-commercial-labor-categories.sql"],
    [25, "025-transfer-merge-replace.sql"],
    [26, "026-transfer-archives-retention.sql"],
    [27, "027-vehicle-update-audit-metadata.sql"],
    [28, "028-private-workshop-services.sql"],
  ] as const) {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=?").get(version))
      continue;
    db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
    try {
      db.exec(
        readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
      );
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Migração interrompida: vínculos inconsistentes.");
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys=ON;");
    }
  }
}
