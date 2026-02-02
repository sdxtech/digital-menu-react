import { useEffect } from 'react'
import { useChefData } from '../lib/chef-data'

const ChefRawMaterial = () => {
  const { rawMaterials, rawMaterialsMeta, fetchRawMaterials } = useChefData()
  const totalPages = rawMaterialsMeta.totalPages

  useEffect(() => {
    fetchRawMaterials(1, 10)
  }, [fetchRawMaterials])

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Raw Material Data
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Data bahan baku</h2>
      </div>

      <div className="rounded-3xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="px-5 py-4 font-semibold">Product Code</th>
                <th className="px-5 py-4 font-semibold">Name</th>
                <th className="px-5 py-4 font-semibold">Unit of Measures</th>
              </tr>
            </thead>
            <tbody>
              {rawMaterialsMeta.loading ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-5 py-10 text-center text-muted">
                    Memuat data raw material...
                  </td>
                </tr>
              ) : rawMaterials.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-5 py-10 text-center text-muted">
                    {rawMaterialsMeta.error
                      ? rawMaterialsMeta.error
                      : 'Belum ada data raw material.'}
                  </td>
                </tr>
              ) : (
                rawMaterials.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-5 py-4">{item.productCode}</td>
                    <td className="px-5 py-4">{item.name}</td>
                    <td className="px-5 py-4">{item.unitOfMeasures}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-xs">
          <span className="text-muted">
            Menampilkan {rawMaterials.length} dari {rawMaterialsMeta.total} data
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                fetchRawMaterials(rawMaterialsMeta.page - 1, rawMaterialsMeta.limit)
              }
              disabled={rawMaterialsMeta.page <= 1 || rawMaterialsMeta.loading}
              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Prev
            </button>
            <span className="text-xs font-semibold text-foreground">
              Page {rawMaterialsMeta.page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                fetchRawMaterials(rawMaterialsMeta.page + 1, rawMaterialsMeta.limit)
              }
              disabled={
                rawMaterialsMeta.page >= totalPages || rawMaterialsMeta.loading
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefRawMaterial
