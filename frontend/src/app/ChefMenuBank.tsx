import { useEffect, useMemo, useState } from 'react'
import { useChefData } from '../lib/chef-data'

const ITEMS_PER_PAGE = 10

const nextFilter = (current: 'all' | 'draft' | 'active') => {
  if (current === 'all') return 'draft'
  if (current === 'draft') return 'active'
  return 'all'
}

const statusLabel = (status: 'draft' | 'active') =>
  status === 'active' ? 'Aktif' : 'Draft'

const approvalLabel = (approvalStatus: 'pending' | 'approved' | 'rejected') => {
  if (approvalStatus === 'approved') return 'Approved'
  if (approvalStatus === 'rejected') return 'Rejected'
  return 'Pending Approval'
}

const ChefMenuBank = () => {
  const { recipes } = useChefData()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'active'>(
    'all',
  )
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const filteredRecipes = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return recipes.filter((recipe) => {
      const byStatus =
        statusFilter === 'all' ? true : recipe.status === statusFilter
      const bySearch =
        !normalized ||
        recipe.name.toLowerCase().includes(normalized) ||
        recipe.category.toLowerCase().includes(normalized)
      return byStatus && bySearch
    })
  }, [recipes, searchTerm, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRecipes.length / ITEMS_PER_PAGE))
  const pageStart = (page - 1) * ITEMS_PER_PAGE
  const pagedRecipes = filteredRecipes.slice(pageStart, pageStart + ITEMS_PER_PAGE)

  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilter])

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  const selectedRecipe =
    selectedRecipeId === null
      ? null
      : recipes.find((item) => item.id === selectedRecipeId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Recipe Data
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Koleksi recipe terkurasi</h2>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Cari recipe..."
            className="w-full min-w-[200px] rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
          />
          <button
            type="button"
            onClick={() => setStatusFilter((prev) => nextFilter(prev))}
            className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Filter: {statusFilter.toUpperCase()}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="px-5 py-4 font-semibold">Nama</th>
                <th className="px-5 py-4 font-semibold">Kategori</th>
                <th className="px-5 py-4 font-semibold">Status recipe</th>
                <th className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecipes.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={4} className="px-5 py-10 text-center text-muted">
                    Belum ada data recipe.
                  </td>
                </tr>
              ) : (
                pagedRecipes.map((recipe) => (
                  <tr key={recipe.id} className="border-t border-border">
                    <td className="px-5 py-4 font-medium">{recipe.name}</td>
                    <td className="px-5 py-4">{recipe.category}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        <span>{statusLabel(recipe.status)}</span>
                        <span className="text-xs text-muted">
                          {approvalLabel(recipe.approvalStatus)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRecipeId((prev) =>
                            prev === recipe.id ? null : recipe.id,
                          )
                        }
                        className="text-xs font-semibold text-primary"
                      >
                        Lihat detail recipe
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-xs">
          <span className="text-muted">
            Menampilkan {pagedRecipes.length} dari {filteredRecipes.length} recipe
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Prev
            </button>
            <span className="text-xs font-semibold text-foreground">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedRecipe ? (
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Recipe Detail
          </p>
          <h3 className="mt-2 text-lg font-semibold">{selectedRecipe.name}</h3>
          <p className="mt-2 text-sm text-muted">{selectedRecipe.description}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Kategori
              </p>
              <p className="mt-2 text-sm font-medium">{selectedRecipe.category}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Harga
              </p>
              <p className="mt-2 text-sm font-medium">Rp {selectedRecipe.price}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ChefMenuBank
