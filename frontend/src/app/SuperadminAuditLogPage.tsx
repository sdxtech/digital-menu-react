import { useCallback, useEffect, useMemo, useState } from "react";
import TablePagination from "../components/TablePagination";
import { apiBaseUrl, apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

type AuditLog = {
  id: string;
  actorName?: string;
  actorEmail?: string;
  role?: string;
  site?: string;
  module: string;
  action: string;
  method: string;
  path: string;
  targetId?: string;
  success: boolean;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
};

type AuditResponse = {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  filters: { modules: string[]; roles: string[]; sites: string[] };
};

type AuditFile = {
  originalName?: string;
  mimeType?: string;
  size?: number;
  storageKey?: string;
  sha256?: string;
  contentStored?: boolean;
};

const PAGE_SIZE = 25;

const localIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const initialStartDate = () => {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
};

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
};

const auditFiles = (details?: Record<string, unknown>): AuditFile[] =>
  Array.isArray(details?.files) ? (details.files as AuditFile[]) : [];

const SuperadminAuditLogPage = () => {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filterOptions, setFilterOptions] = useState<AuditResponse["filters"]>({
    modules: [],
    roles: [],
    sites: [],
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(() => localIsoDate(new Date()));
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const value = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (search) value.set("search", search);
    if (moduleFilter) value.set("module", moduleFilter);
    if (roleFilter) value.set("role", roleFilter);
    if (siteFilter) value.set("site", siteFilter);
    if (statusFilter) value.set("status", statusFilter);
    if (startDate) value.set("startDate", startDate);
    if (endDate) value.set("endDate", endDate);
    return value;
  }, [
    endDate,
    moduleFilter,
    page,
    roleFilter,
    search,
    siteFilter,
    startDate,
    statusFilter,
  ]);

  const fetchLogs = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<AuditResponse>(
        `/superadmin/audit-logs?${params.toString()}`,
        undefined,
        accessToken,
      );
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setFilterOptions(data.filters ?? { modules: [], roles: [], sites: [] });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Failed to load audit logs.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, params]);

  useEffect(() => {
    fetchLogs().catch(() => null);
  }, [fetchLogs]);

  useEffect(
    () => setPage(1),
    [
      moduleFilter,
      roleFilter,
      siteFilter,
      statusFilter,
      startDate,
      endDate,
      search,
    ],
  );

  const exportPdf = async () => {
    if (!accessToken || !startDate || !endDate) {
      setError("Select a start date and end date before exporting.");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const exportParams = new URLSearchParams(params);
      exportParams.delete("page");
      exportParams.delete("limit");
      const response = await fetch(
        `${apiBaseUrl}/superadmin/audit-logs/export?${exportParams.toString()}`,
        {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(payload.message || "Failed to export audit PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-log-${startDate}-${endDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      await fetchLogs();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to export audit PDF.",
      );
    } finally {
      setExporting(false);
    }
  };

  const downloadAuditFile = async (key: string) => {
    if (!accessToken) return;
    setError("");
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/superadmin/audit-logs/files/download-url?key=${encodeURIComponent(key)}`,
        undefined,
        accessToken,
      );
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to download audit file.",
      );
    }
  };

  return (
    <section className="space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="mt-1 text-sm text-muted">
            Review system changes and export a PDF report for a selected period.
          </p>
        </div>
        <button
          type="button"
          onClick={exportPdf}
          disabled={exporting || !startDate || !endDate}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          <i className="bi bi-file-earmark-pdf mr-2" />
          {exporting ? "Preparing PDF..." : "Export PDF"}
        </button>
      </div>

      <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) =>
              event.key === "Enter" && setSearch(searchInput.trim())
            }
            placeholder="Search user, action, or target"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <select
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All modules</option>
            {filterOptions.modules.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All roles</option>
            {filterOptions.roles.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={siteFilter}
            onChange={(event) => setSiteFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All sites</option>
            {filterOptions.sites.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="Start date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="End date"
          />
          <button
            type="button"
            onClick={() => setSearch(searchInput.trim())}
            className="rounded-md border border-primary bg-primary-soft px-4 py-2 text-xs font-semibold text-primary"
          >
            Apply Search
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
        <TablePagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          loading={loading}
          summary={`Showing ${items.length} of ${total} audit records`}
        />
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.12em] text-muted">
                <th className="px-3 py-3">Time</th>
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">Role / Site</th>
                <th className="px-3 py-3">Module</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Loading audit logs...
                  </td>
                </tr>
              ) : null}
              {!loading && !items.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No audit records match the selected filters.
                  </td>
                </tr>
              ) : null}
              {!loading &&
                items.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold">
                        {item.actorName || "System"}
                      </p>
                      <p className="text-xs text-muted">
                        {item.actorEmail || "-"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{item.role || "-"}</p>
                      <p className="text-xs text-muted">
                        {item.site || "Global"}
                      </p>
                    </td>
                    <td className="px-3 py-3">{item.module}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{item.action}</p>
                      <p className="max-w-xs truncate text-xs text-muted">
                        {item.path}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${item.success ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
                      >
                        {item.success ? "Success" : `Failed ${item.statusCode}`}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(item)}
                        className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-primary"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Audit Details</h2>
                <p className="text-xs text-muted">
                  {formatDateTime(selected.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xl text-muted"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">User</dt>
                <dd>
                  {selected.actorName || "System"} ({selected.actorEmail || "-"}
                  )
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Role / Site</dt>
                <dd>
                  {selected.role || "-"} / {selected.site || "Global"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Request</dt>
                <dd>
                  {selected.method} {selected.path}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Target</dt>
                <dd>{selected.targetId || "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">IP Address</dt>
                <dd>{selected.ipAddress || "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Status</dt>
                <dd>
                  {selected.statusCode} /{" "}
                  {selected.success ? "Success" : "Failed"}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <p className="text-xs text-muted">Browser</p>
              <p className="break-all text-sm">{selected.userAgent || "-"}</p>
            </div>
            {auditFiles(selected.details).length ? (
              <div className="mt-4">
                <p className="text-xs text-muted">Uploaded files</p>
                <div className="mt-2 space-y-2">
                  {auditFiles(selected.details).map((file, index) => (
                    <div
                      key={`${file.storageKey ?? file.originalName}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {file.originalName || "Uploaded file"}
                        </p>
                        <p className="text-xs text-muted">
                          {file.mimeType || "Unknown type"} · {file.size ?? 0}{" "}
                          bytes
                        </p>
                        {file.sha256 ? (
                          <p className="mt-1 break-all font-mono text-[10px] text-muted">
                            SHA-256: {file.sha256}
                          </p>
                        ) : null}
                      </div>
                      {file.contentStored && file.storageKey ? (
                        <button
                          type="button"
                          onClick={() =>
                            downloadAuditFile(file.storageKey as string)
                          }
                          className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary"
                        >
                          Download original
                        </button>
                      ) : (
                        <span className="text-xs text-rose-600">
                          File was not archived
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-4">
              <p className="text-xs text-muted">Recorded details</p>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">
                {JSON.stringify(selected.details ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default SuperadminAuditLogPage;
