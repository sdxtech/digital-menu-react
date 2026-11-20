# Internal inventory

Inventory replaces the Looker iframe on the existing Storekeeper and Superadmin inventory routes. The existing visibility flag only controls access to the page; activated sites continue recording Store Request movements when the page is hidden.

## Database prerequisite

Inventory uses MongoDB transactions to commit Store Request status changes and stock movements together. A replica set or sharded deployment is required. Standalone MongoDB can continue serving existing workflows for sites without inventory; activation is refused without transaction support. No application environment files or production configuration are changed by this feature.

For host-based local development, an optional override enables a single-node replica set while retaining the existing volume:

```powershell
docker compose -f infra/docker-compose.yml -f infra/docker-compose.inventory.yml up -d mongo
```

This restarts the local MongoDB service. Apply it deliberately when local work can tolerate the restart. Do not remove the data volume. The override advertises `localhost:27017` for applications running on the host; container-based and production deployments need their own reachable replica-set addresses. Keep the override in subsequent local Compose commands. Production database topology changes remain deployment-owner work.

## Site activation

1. Finish in-progress receipt/issuance saves before taking the opening physical balance. Activate during a short pause in Storekeeper processing so the physical count and the activation boundary agree.
2. Open Inventory, select the site when using Superadmin, and download the opening template.
3. Fill `Kode Item`, `Satuan`, and `Jumlah Stok Awal` on the first worksheet. Quantities must be numeric Excel cells, non-negative, and have no more than six decimals. Use the item's master SR unit. Maximum: 5,000 rows and 2 MB. Duplicate codes, unknown codes, mismatched units and NMP are rejected.
4. Upload and review all rows. A valid preview is scoped to its site/user and expires after 30 minutes. Confirmation revalidates the master data and atomically imports the opening balance and activates the site. Only one opening import per site is permitted. Omitted items start at zero.

Already completed Store Requests are represented by the opening physical balance and are never backfilled. Later Superadmin corrections to those historic batches also remain excluded. New issuance uses the actual quantities from complete-batch reconciliation. NMP remains in existing Store Request workflows but never affects stock.

## Daily use and corrections

- Receive goods only when physically received. Each receipt accepts up to 200 distinct master items. Supplier and received date are required; delivery-note reference and notes are optional. Inventory quantities use the unit established when the item first enters that site's ledger. Master unit changes do not reinterpret historical stock.
- Saving a receipt immediately increases stock. A stable request identifier prevents duplicate stock on retries. Superadmin can edit a receipt using the full receipt form. Saving atomically cancels its old stock effect and creates a replacement receipt, keeping both in history. Concurrent or stale edits are rejected and retries use a stable request identifier.
- Only Superadmin can cancel a receipt, with a mandatory reason. Reversal subtracts the original quantities once and retains both records.
- Completing a Store Request deducts the submitted Actual QTY once per batch, never the planned quantity. Editing the form or checking availability does not change stock. Stock out is dated at the successful Complete submission time (displayed in WIB), even when the production date is earlier. Zero actual quantity does not deduct stock. Corrections apply only the quantity difference; cancelling a tracked issuance reverses its stock effect. Deletion is blocked until its outstanding issuance has been reversed.
- Negative stock is allowed. Reconciliation shows an advisory warning and the stock table highlights negative balances. Availability previews are estimates, not reservations.
- Material-specific conversion factors take precedence, with existing active global conversions as fallback. Missing or ambiguous conversions reject the save and roll back the associated status change.
- This version tracks quantities only: no purchasing orders, valuation, FIFO, price updates, expiry tracking, transfer, or periodic stock-opname adjustments. Corrections to a wrongly imported opening balance require follow-up work; there is no reset/reimport action.

## Stock Movements

The movement table and Excel export use one row per item: No, Date, No. PO, Production Code, Product Code, Name, QTY, UOM, Transaction Type, User. QTY is absolute (up to six decimals); opening entries display OPENING BALANCE, while other negative ledger changes display STOCK OUT and non-negative changes display STOCK IN. Zero opening balances remain visible as OPENING BALANCE. Opening, reversal and correction records are retained. Expand the item name for transaction details. The Action column after User provides Edit and Cancel for Superadmin on active receipts; both actions apply to the entire receipt.

No. PO uses the existing receipt reference (including legacy delivery-note references); missing references display `-`. Receipt reversals resolve that reference from the original receipt within the same site. Production Code comes from the production batch key; legacy batches identified only by a document ID display `-`.

`GET /inventory/movements?view=lines` returns paginated item rows, with `total` counting matching items. The default endpoint response remains grouped by transaction. Item code/name and WIB date filters apply to both the table and the full filtered Excel export.

## Verification

CI starts an isolated MongoDB replica set on port 27028 and runs the transaction integration tests with the backend suite. Locally, without `INVENTORY_TEST_MONGO_URI`, those integration tests are skipped; a release must run them against an isolated replica set.

```powershell
docker run --detach --rm --name digital-menu-inventory-test --publish 127.0.0.1:27028:27017 mongo:7 --replSet inventory-test --bind_ip_all
docker exec digital-menu-inventory-test mongosh --quiet --eval 'rs.initiate()'
# Wait for the node to become primary, then run from backend:
$env:INVENTORY_TEST_MONGO_URI = 'mongodb://127.0.0.1:27028/?directConnection=true'
npm test -- --runInBand
# After the run:
docker stop digital-menu-inventory-test
```

The suite accepts only localhost/127.0.0.1 on port 27028, creates a unique `inventory_test_...` database, and removes only that test database. Never point it at the application database.
