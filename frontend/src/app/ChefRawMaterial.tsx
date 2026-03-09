import { useEffect } from 'react'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'

const ChefRawMaterial = () => {
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
                  <th className="px-5 py-4 font-semibold">Unit of Measures</th>
                </tr>
              </thead>
              <tbody>
                {rawMaterialsMeta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={4} className="px-5 py-10 text-center text-muted">
                      Loading raw materials...
                    </td>
                  </tr>
                ) : rawMaterials.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={4} className="px-5 py-10 text-center text-muted">
                      {rawMaterialsMeta.error
                        ? rawMaterialsMeta.error
                        : 'No raw materials yet.'}
                    </td>
                  </tr>
                ) : (
                  rawMaterials.map((item, index) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-5 py-4 text-sm text-muted">
                        {(rawMaterialsMeta.page - 1) * rawMaterialsMeta.limit +
                          index +
                          1}
                      </td>
                      <td className="px-5 py-4">{item.productCode}</td>
                      <td className="px-5 py-4">{item.name}</td>
                      <td className="px-5 py-4">
                        {formatUnitLabel(item.unitOfMeasures)}
                      </td>
                    </tr>
                  ))
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

