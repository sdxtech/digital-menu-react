import { useState, useEffect } from 'react'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'

type NotificationItem = {
  read?: boolean
  componentKey?: string
  payload?: {
    productCode?: string
  }
}

const ChefRawMaterial = () => {
  const { user, accessToken } = useAuth();
  const rawRole = user?.roles?.[0] || user?.role || '';
  const cleanRole = rawRole.startsWith('/') ? rawRole.slice(1) : rawRole;
  const apiRole = cleanRole === 'chef' ? 'chef' : cleanRole;
  const currentSiteCode = user?.site || 'global';

  // 🚀 INJECTED STATE AND EFFECT FOR RAW MATERIAL NOTIFICATION HIGHLIGHTS
  const [unreadMaterialCodes, setUnreadMaterialCodes] = useState<string[]>([]);

  useEffect(() => {
    const fetchActiveNotifications = async () => {
      try {
        if (!accessToken) return;
        const data = await apiFetch<NotificationItem[]>(
          `/notifications/role-unread?siteCode=${encodeURIComponent(currentSiteCode)}&targetUserRole=${encodeURIComponent(apiRole)}&componentKey=RAW_MATERIAL_DATA_BANK`,
          undefined,
          accessToken,
        );
        if (Array.isArray(data)) {
          const productCodes = data
            .filter((n) => !n.read && n.componentKey === 'RAW_MATERIAL_DATA_BANK')
            .map((n) => n.payload?.productCode)
            .filter((value): value is string => Boolean(value));
          setUnreadMaterialCodes(productCodes);
        }
      } catch (err) {
        console.error('Failed to load active raw material notifications for highlights:', err);
      }
    };
    
    if (user && accessToken) {
      fetchActiveNotifications();
    }
  }, [user, accessToken, apiRole, currentSiteCode]);
  const { rawMaterials, rawMaterialsMeta, fetchRawMaterials } = useChefData()
  const totalPages = rawMaterialsMeta.totalPages

  useEffect(() => {
    fetchRawMaterials(1, 10)
  }, [fetchRawMaterials])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Raw Material Data</h1>
        </div>

        <div className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-white px-5 py-4 text-xs">
            <span className="text-muted">
              Showing {rawMaterials.length} of {rawMaterialsMeta.total} items
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  fetchRawMaterials(
                    rawMaterialsMeta.page - 1,
                    rawMaterialsMeta.limit,
                  )
                }
                disabled={rawMaterialsMeta.page <= 1 || rawMaterialsMeta.loading}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Prev
              </button>
              <span className="text-xs font-semibold text-foreground">
                Page {rawMaterialsMeta.page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  fetchRawMaterials(
                    rawMaterialsMeta.page + 1,
                    rawMaterialsMeta.limit,
                  )
                }
                disabled={
                  rawMaterialsMeta.page >= totalPages || rawMaterialsMeta.loading
                }
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Product Code</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Vendor</th>
                  <th className="px-5 py-4 font-semibold">Unit of Measures</th>
                </tr>
              </thead>
              <tbody>
                {rawMaterialsMeta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      Loading raw materials...
                    </td>
                  </tr>
                ) : rawMaterials.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      {rawMaterialsMeta.error
                        ? rawMaterialsMeta.error
                        : 'No raw materials yet.'}
                    </td>
                  </tr>
                ) : (
                  rawMaterials.map((item, index) => {
                    const isUnread = unreadMaterialCodes.includes(item.productCode);
                    return (
                      <tr 
                        key={item.id} 
                        className={`border-t border-border transition-colors duration-500 ${
                          isUnread ? 'bg-yellow-50 animate-pulse' : ''
                        }`}
                      >
                      <td className="px-5 py-4 text-sm text-muted">
                        {(rawMaterialsMeta.page - 1) * rawMaterialsMeta.limit +
                          index +
                          1}
                      </td>
                      <td className="px-5 py-4">{item.productCode}</td>
                      <td className="px-5 py-4">{item.name}</td>
                      <td className="px-5 py-4">{item.vendor || '-'}</td>
                      <td className="px-5 py-4">
                        {formatUnitLabel(item.unitOfMeasures)}
                      </td>
                    </tr>
                  ); // 🌟 Changed from ) to );
                })
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefRawMaterial

