import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import TablePagination from "../components/TablePagination";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useChefData } from "../lib/chef-data";
import { formatQuantity } from "../lib/quantity";
import { formatRecipeVersion } from "../lib/recipe-version";
import { formatUnitLabel } from "../lib/unit-of-measures";
import {
  downloadSpreadsheet,
  type SpreadsheetCell,
} from "../lib/spreadsheet-export";

const GROUPS_PER_PAGE = 10;

type Ingredient = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  qty: number;
  vendor?: string;
  price?: number;
  ingredientCost?: number;
};

type Menu = {
  id: string;
  productionCode?: string;
  submittedByName?: string;
  recipeId?: string;
  recipeCode?: string;
  recipeVersion?: number;
  menuName: string;
  clientName?: string;
  category: string;
  portion: number;
  cost?: number;
  estimatedCost?: number;
  estimatedCostPerPax?: number;
  sellingPricePerPax?: number;
  sellingQuantity?: number;
  estimatedRevenue?: number;
  salesInputBy?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
};

type Group = {
  date: string;
  productionCode?: string;
  items: Menu[];
  summary: Ingredient[];
};

const formatPrice = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? "-"
    : new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(value);

const normalizeIntegerInput = (value: string) =>
  value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

const formatIntegerInput = (value: string) =>
  normalizeIntegerInput(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const totalOf = (items: Menu[], selector: (item: Menu) => number | undefined) =>
  items.reduce((total, item) => {
    const value = selector(item);
    return total + (value !== undefined && Number.isFinite(value) ? value : 0);
  }, 0);

const hasSalesDetails = (item: Menu) =>
  Number.isFinite(Number(item.sellingPricePerPax)) &&
  Number.isFinite(Number(item.sellingQuantity));

const isSubmittedGroup = (group: Group) =>
  group.items.length > 0 && group.items.every(hasSalesDetails);

const AdminSiteMenuProductionPage = () => {
  const { accessToken } = useAuth();
  const { updateMenuProductionBatchSalesDetails } = useChefData();
  const [groups, setGroups] = useState<Group[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [values, setValues] = useState<
    Record<string, { price: string; quantity: string }>
  >({});
  const [page, setPage] = useState(1);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const fetchGroups = useCallback(async () => {
    if (!accessToken) return;
    const data = await apiFetch<{ items?: Group[] }>(
      "/menu-productions/store-requests?approvalStatus=pending",
      undefined,
      accessToken,
    );
    setGroups(
      [...(data.items ?? [])]
        .filter((group) => !isSubmittedGroup(group))
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  }, [accessToken]);

  useEffect(() => {
    fetchGroups().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to load menu productions.",
      ),
    );
  }, [fetchGroups]);

  const visibleGroups = useMemo(
    () => groups.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE),
    [groups, page],
  );
  const totalPages = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE));
  const groupKey = (group: Group) =>
    `${group.date}__${group.productionCode ?? "no-code"}`;
  const batchValues = (group: Group) => {
    const key = groupKey(group);
    const saved = group.items[0];
    return (
      values[key] ?? {
        price:
          saved?.sellingPricePerPax === undefined
            ? ""
            : String(saved.sellingPricePerPax),
        quantity:
          saved?.sellingQuantity === undefined
            ? ""
            : String(saved.sellingQuantity),
      }
    );
  };

  const save = async (group: Group) => {
    const current = batchValues(group);
    const price = Number(current.price);
    const quantity = Number(current.quantity);
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(quantity) ||
      quantity < 0
    ) {
      setError(
        "Selling price and selling quantity must be valid non-negative numbers.",
      );
      return;
    }
    setSavingId(groupKey(group));
    setError("");
    setMessage("");
    try {
      await updateMenuProductionBatchSalesDetails(group.productionCode ?? "", {
        sellingPricePerPax: price,
        sellingQuantity: quantity,
      });
      setMessage(
        `${group.productionCode ?? "Production batch"} submitted to Unit Manager.`,
      );
      setGroups((previous) =>
        previous.filter((item) => groupKey(item) !== groupKey(group)),
      );
      setValues((previous) => {
        const next = { ...previous };
        delete next[groupKey(group)];
        return next;
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to save sales details.",
      );
    } finally {
      setSavingId("");
    }
  };

  const exportGroup = (group: Group) => {
    const menuRows: SpreadsheetCell[][] = [
      [
        "No",
        "Production Date",
        "Client Name",
        "Production Code",
        "Menu Name",
        "Version",
        "Recipe Code",
        "Category",
        "Portion",
        "Estimated Cost",
        "Cost/Pax",
        "Selling Price/Pax",
        "Pax Calculation",
        "Estimated Revenue",
      ],
      ...group.items.map((menu, index) => [
        index + 1,
        group.date,
        menu.clientName ?? "",
        group.productionCode ?? "",
        menu.menuName,
        formatRecipeVersion(menu.recipeVersion),
        menu.recipeCode ?? menu.recipeId ?? "",
        menu.category,
        menu.portion,
        menu.estimatedCost ?? menu.cost ?? "",
        menu.estimatedCostPerPax ?? "",
        menu.sellingPricePerPax ?? "",
        menu.sellingQuantity ?? "",
        menu.estimatedRevenue ?? "",
      ]),
    ];
    const ingredientRows: SpreadsheetCell[][] = [
      [
        "No",
        "Product Code",
        "Client Name",
        "Ingredient Name",
        "Qty",
        "Unit",
        "Vendor",
        "Price",
        "Ingredient Cost",
      ],
      ...group.summary.map((item, index) => [
        index + 1,
        item.productCode,
        group.items[0]?.clientName ?? "",
        item.name,
        item.qty,
        formatUnitLabel(item.unitOfMeasures),
        item.vendor ?? "",
        item.price ?? "",
        item.ingredientCost ?? "",
      ]),
    ];
    const safeCode = (group.productionCode ?? "no-code").replace(
      /[\\/:*?"<>|]/g,
      "-",
    );
    downloadSpreadsheet(`menu-production-${group.date}-${safeCode}.xlsx`, [
      { name: "Menu Production", rows: menuRows },
      { name: "Ingredient Summary", rows: ingredientRows },
    ]);
  };

  return (
    <section className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-semibold">Menu Production Sales Input</h1>
        <p className="mt-1 text-sm text-muted">
          Complete selling price and quantity before Unit Manager approval.
        </p>
      </div>
      {error ? (
        <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Menu Production Sales Input</h2>
        <p className="mt-1 text-sm text-muted">
          Review production batches from the Chef team and complete sales
          information.
        </p>
        <TablePagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={`Showing ${visibleGroups.length} of ${groups.length} production batches`}
          className="mt-4"
        />
        <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-4 py-3">No</th>
                <th className="px-4 py-3">Production date</th>
                <th className="px-4 py-3">Production code</th>
                <th className="px-4 py-3">Client name</th>
                <th className="px-4 py-3">Chef</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    No production menus pending sales input.
                  </td>
                </tr>
              ) : (
                visibleGroups.map((group, index) => {
                  const key = groupKey(group);
                  const expanded = expandedGroups.includes(key);
                  const chef =
                    Array.from(
                      new Set(
                        group.items
                          .map((item) => item.submittedByName?.trim())
                          .filter(Boolean),
                      ),
                    ).join(", ") || "-";
                  const estimatedTotal = totalOf(
                    group.items,
                    (item) => item.estimatedCost ?? item.cost,
                  );
                  const costPerPaxTotal = totalOf(
                    group.items,
                    (item) => item.estimatedCostPerPax,
                  );
                  const sellingPrice = Number(batchValues(group).price);
                  const sellingQuantity = Number(batchValues(group).quantity);
                  const estimatedRevenue = sellingPrice * sellingQuantity;
                  const revenuePercentage =
                    estimatedRevenue > 0
                      ? (estimatedTotal / estimatedRevenue) * 100
                      : undefined;
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-border">
                        <td className="px-4 py-3 text-muted">
                          {(page - 1) * GROUPS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-4 py-3">{group.date}</td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {group.productionCode ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          {group.items[0]?.clientName ?? "-"}
                        </td>
                        <td className="px-4 py-3">{chef}</td>
                        <td className="px-4 py-3">
                          {group.items[0]?.salesInputBy ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                            {group.items.length} menu
                            {group.items.length === 1 ? "" : "s"} pending
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedGroups((prev) =>
                                  expanded
                                    ? prev.filter((item) => item !== key)
                                    : [...prev, key],
                                )
                              }
                              className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary"
                            >
                              {expanded ? "Hide details" : "View details"}
                            </button>
                            <button
                              type="button"
                              onClick={() => exportGroup(group)}
                              className="rounded-md border border-success bg-white px-3 py-2 text-xs font-semibold text-success"
                            >
                              <i
                                className="bi bi-download mr-2"
                                aria-hidden="true"
                              />
                              Export
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-border bg-background">
                          <td colSpan={7} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-12">
                              <div className="rounded-md border border-border bg-surface p-4 lg:col-span-5">
                                <p className="text-xs text-muted">Menu list</p>
                                <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                  <table className="dm-table min-w-full text-sm">
                                    <thead className="bg-background">
                                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                        <th className="px-4 py-3">No</th>
                                        <th className="px-4 py-3">Menu ID</th>
                                        <th className="px-4 py-3">Menu</th>
                                        <th className="px-4 py-3">Category</th>
                                        <th className="px-4 py-3">Portion</th>
                                        <th className="px-4 py-3">
                                          Estimated Cost
                                        </th>
                                        <th className="px-4 py-3">Cost/Pax</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.items.map((menu, menuIndex) => (
                                        <tr
                                          key={menu.id}
                                          className="border-t border-border"
                                        >
                                          <td className="px-4 py-3 text-muted">
                                            {menuIndex + 1}
                                          </td>
                                          <td className="px-4 py-3 font-medium">
                                            {menu.recipeCode ?? "-"}
                                          </td>
                                          <td className="px-4 py-3">
                                            {menu.menuName}
                                          </td>
                                          <td className="px-4 py-3">
                                            {menu.category}
                                          </td>
                                          <td className="px-4 py-3">
                                            {menu.portion}
                                          </td>
                                          <td className="px-4 py-3 font-medium">
                                            {formatPrice(
                                              menu.estimatedCost ?? menu.cost,
                                            )}
                                          </td>
                                          <td className="px-4 py-3 font-medium">
                                            {formatPrice(
                                              menu.estimatedCostPerPax,
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="bg-background">
                                      <tr className="border-t-2 border-primary">
                                        <td
                                          colSpan={5}
                                          className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                        >
                                          Total
                                        </td>
                                        <td className="px-4 py-3 font-bold">
                                          {formatPrice(estimatedTotal)}
                                        </td>
                                        <td className="px-4 py-3 font-bold">
                                          {formatPrice(costPerPaxTotal)}
                                        </td>
                                      </tr>
                                      <tr className="border-t border-border">
                                        <td
                                          colSpan={5}
                                          className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                        >
                                          Selling Price/Pax
                                        </td>
                                        <td colSpan={2} className="px-4 py-3">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatIntegerInput(
                                              batchValues(group).price,
                                            )}
                                            onChange={(event) =>
                                              setValues((prev) => ({
                                                ...prev,
                                                [key]: {
                                                  ...batchValues(group),
                                                  price: normalizeIntegerInput(
                                                    event.target.value,
                                                  ),
                                                },
                                              }))
                                            }
                                            className="w-full rounded-md border border-border bg-white px-2 py-2 text-sm"
                                          />
                                        </td>
                                      </tr>
                                      <tr className="border-t border-border">
                                        <td
                                          colSpan={5}
                                          className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                        >
                                          Pax Calculation
                                        </td>
                                        <td colSpan={2} className="px-4 py-3">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatIntegerInput(
                                              batchValues(group).quantity,
                                            )}
                                            onChange={(event) =>
                                              setValues((prev) => ({
                                                ...prev,
                                                [key]: {
                                                  ...batchValues(group),
                                                  quantity: normalizeIntegerInput(
                                                    event.target.value,
                                                  ),
                                                },
                                              }))
                                            }
                                            className="w-full rounded-md border border-border bg-white px-2 py-2 text-sm"
                                          />
                                        </td>
                                      </tr>
                                      <tr className="border-t border-border">
                                        <td
                                          colSpan={5}
                                          className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                        >
                                          Estimated Revenue
                                        </td>
                                        <td
                                          colSpan={2}
                                          className="px-4 py-3 font-bold"
                                        >
                                          {formatPrice(
                                            Number(batchValues(group).price) *
                                              Number(
                                                batchValues(group).quantity,
                                              ),
                                          )}
                                        </td>
                                      </tr>
                                      <tr className="border-t border-border">
                                        <td
                                          colSpan={5}
                                          className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                        >
                                          Revenue Percentage
                                        </td>
                                        <td
                                          colSpan={2}
                                          className="px-4 py-3 text-center font-bold"
                                        >
                                          {revenuePercentage === undefined
                                            ? "-"
                                            : `${revenuePercentage.toFixed(2)}%`}
                                        </td>
                                      </tr>
                                      <tr className="border-t border-border">
                                        <td colSpan={5} />
                                        <td colSpan={2} className="px-4 py-3">
                                          <button
                                            type="button"
                                            onClick={() => save(group)}
                                            disabled={savingId === key}
                                            className="w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                                          >
                                            {savingId === key
                                              ? "Saving..."
                                              : "Submit to Unit Manager"}
                                          </button>
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              </div>
                              <div className="rounded-md border border-border bg-surface p-4 lg:col-span-7">
                                <p className="text-xs text-muted">
                                  Ingredient summary
                                </p>
                                <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                  <table className="dm-table min-w-full text-sm">
                                    <thead className="bg-background">
                                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                        <th className="px-4 py-3">No</th>
                                        <th className="px-4 py-3">
                                          Product code
                                        </th>
                                        <th className="px-4 py-3">
                                          Ingredient name
                                        </th>
                                        <th className="px-4 py-3">Qty</th>
                                        <th className="px-4 py-3">Unit</th>
                                        <th className="px-4 py-3">Vendor</th>
                                        <th className="px-4 py-3">Price</th>
                                        <th className="px-4 py-3">
                                          Ingredient Cost
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.summary.length === 0 ? (
                                        <tr>
                                          <td
                                            colSpan={8}
                                            className="px-4 py-6 text-center text-muted"
                                          >
                                            No ingredients available.
                                          </td>
                                        </tr>
                                      ) : (
                                        group.summary.map((item, itemIndex) => (
                                          <tr
                                            key={`${item.productCode}-${itemIndex}`}
                                            className="border-t border-border"
                                          >
                                            <td className="px-4 py-3 text-muted">
                                              {itemIndex + 1}
                                            </td>
                                            <td className="px-4 py-3">
                                              {item.productCode}
                                            </td>
                                            <td className="px-4 py-3">
                                              {item.name}
                                            </td>
                                            <td className="px-4 py-3">
                                              {formatQuantity(item.qty)}
                                            </td>
                                            <td className="px-4 py-3">
                                              {formatUnitLabel(
                                                item.unitOfMeasures,
                                              )}
                                            </td>
                                            <td className="px-4 py-3">
                                              {item.vendor ?? "-"}
                                            </td>
                                            <td className="px-4 py-3">
                                              {formatPrice(item.price)}
                                            </td>
                                            <td className="px-4 py-3">
                                              {formatPrice(item.ingredientCost)}
                                            </td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

export default AdminSiteMenuProductionPage;
