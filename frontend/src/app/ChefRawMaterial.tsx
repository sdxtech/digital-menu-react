import { useEffect, useState } from 'react'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel, unitOfMeasuresOptions } from '../lib/unit-of-measures'

const ChefRawMaterial = () => {
  const {
    rawMaterials,
    rawMaterialsMeta,
    fetchRawMaterials,
    updateRawMaterial,
  } = useChefData()
  const totalPages = rawMaterialsMeta.totalPages
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    productCode: '',
    name: '',
    unitOfMeasures: '',
  })
  const [editError, setEditError] = useState('')
  const [editMessage, setEditMessage] = useState('')

  useEffect(() => {
    fetchRawMaterials(1, 10)
  }, [fetchRawMaterials])

  const startEdit = (id: string) => {
    const target = rawMaterials.find((item) => item.id === id)
    if (!target) return
    setEditingId(id)
    setEditForm({
      productCode: target.productCode,
      name: target.name,
      unitOfMeasures: target.unitOfMeasures,
    })
    setEditError('')
    setEditMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const handleEditChange = (
    field: 'productCode' | 'name' | 'unitOfMeasures',
    value: string,
  ) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    const next = {
      productCode: editForm.productCode.trim(),
      name: editForm.name.trim(),
      unitOfMeasures: editForm.unitOfMeasures.trim(),
    }

    if (!next.productCode || !next.name || !next.unitOfMeasures) {
      setEditError('Please complete all fields before saving.')
      return
    }

    try {
      await updateRawMaterial(editingId, next)
      setEditMessage('Raw material updated.')
      setEditError('')
      setEditingId(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update raw material.'
      setEditError(message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Raw Material Data
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Raw material data</h2>
      </div>

      <div className="rounded-3xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="px-5 py-4 font-semibold">Product Code</th>
                <th className="px-5 py-4 font-semibold">Name</th>
                <th className="px-5 py-4 font-semibold">Unit of Measures</th>
                <th className="px-5 py-4 font-semibold">Action</th>
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
                rawMaterials.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-5 py-4">
                      {editingId === item.id ? (
                        <input
                          type="text"
                          value={editForm.productCode}
                          onChange={(event) =>
                            handleEditChange('productCode', event.target.value)
                          }
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        />
                      ) : (
                        item.productCode
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {editingId === item.id ? (
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(event) =>
                            handleEditChange('name', event.target.value)
                          }
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        />
                      ) : (
                        item.name
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {editingId === item.id ? (
                        <select
                          value={editForm.unitOfMeasures}
                          onChange={(event) =>
                            handleEditChange('unitOfMeasures', event.target.value)
                          }
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        >
                          <option value="">Select a unit</option>
                          {unitOfMeasuresOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        formatUnitLabel(item.unitOfMeasures)
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {editingId === item.id ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(item.id)}
                          className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {editError ? (
          <p className="px-5 pb-2 text-xs font-medium text-red-600">
            {editError}
          </p>
        ) : null}
        {editMessage ? (
          <p className="px-5 pb-2 text-xs font-medium text-primary">
            {editMessage}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-xs">
          <span className="text-muted">
            Showing {rawMaterials.length} of {rawMaterialsMeta.total} items
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
