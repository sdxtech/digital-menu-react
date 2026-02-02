import { useMemo, useState } from 'react'
import { useChefData } from '../lib/chef-data'

type MenuInputRow = {
  id: string
  recipeId: string
  portion: number | ''
}

const createMenuInputRow = (): MenuInputRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  recipeId: '',
  portion: '',
})

const approvalLabel = (approvalStatus: 'pending' | 'approved' | 'rejected') => {
  if (approvalStatus === 'approved') return 'Approved'
  if (approvalStatus === 'rejected') return 'Rejected'
  return 'Pending Approval'
}

const ChefMenuCycle = () => {
  const { recipes, menuProductions, addMenuProduction } = useChefData()
  const [productionDate, setProductionDate] = useState('')
  const [menuRows, setMenuRows] = useState<MenuInputRow[]>([createMenuInputRow()])
  const [inputError, setInputError] = useState('')
  const [inputMessage, setInputMessage] = useState('')
  const [timelineMessage, setTimelineMessage] = useState('')

  const recipeById = useMemo(() => {
    return recipes.reduce<Record<string, (typeof recipes)[number]>>((acc, recipe) => {
      acc[recipe.id] = recipe
      return acc
    }, {})
  }, [recipes])

  const productionStats = useMemo(() => {
    const approved = menuProductions.filter(
      (item) => item.approvalStatus === 'approved',
    ).length
    const pending = menuProductions.filter(
      (item) => item.approvalStatus === 'pending',
    ).length
    const rejected = menuProductions.filter(
      (item) => item.approvalStatus === 'rejected',
    ).length
    return { approved, pending, rejected, total: menuProductions.length }
  }, [menuProductions])

  const timelineGroups = useMemo(() => {
    const grouped: Record<string, typeof menuProductions> = {}
    menuProductions.forEach((item) => {
      if (!grouped[item.productionDate]) grouped[item.productionDate] = []
      grouped[item.productionDate].push(item)
    })
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  }, [menuProductions])

  const updateRowRecipe = (id: string, recipeId: string) => {
    setMenuRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, recipeId } : row)),
    )
  }

  const updateRowPortion = (id: string, value: string) => {
    const digitsOnly = value.replace(/\D/g, '')
    setMenuRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              portion: digitsOnly === '' ? '' : Number.parseInt(digitsOnly, 10),
            }
          : row,
      ),
    )
  }

  const handleAddMenuRow = () => {
    if (!productionDate) {
      setInputError('Pilih tanggal produksi terlebih dahulu.')
      setInputMessage('')
      return
    }

    setMenuRows((prev) => [...prev, createMenuInputRow()])
    setInputError('')
    setInputMessage('Baris menu baru ditambahkan.')
  }

  const handleRemoveMenuRow = (id: string) => {
    setMenuRows((prev) => {
      const nextRows = prev.filter((row) => row.id !== id)
      return nextRows.length === 0 ? [createMenuInputRow()] : nextRows
    })
    setInputError('')
    setInputMessage('Baris menu dihapus.')
  }

  const handleSubmitToTimeline = () => {
    if (!productionDate) {
      setInputError('Pilih tanggal produksi terlebih dahulu.')
      setInputMessage('')
      return
    }

    const usedRows = menuRows.filter(
      (row) => row.recipeId !== '' || row.portion !== '',
    )

    if (usedRows.length === 0) {
      setInputError(
        'Isi minimal 1 baris menu sebelum diajukan ke Unit Manager.',
      )
      setInputMessage('')
      return
    }

    const payload: Array<{
      menuName: string
      category: string
      portion: number
      productionDate: string
    }> = []

    for (const row of usedRows) {
      if (!row.recipeId || row.portion === '') {
        setInputError('Pastikan setiap baris terisi menu dan portion.')
        setInputMessage('')
        return
      }

      const portionValue = Number(row.portion)
      if (!Number.isInteger(portionValue) || portionValue <= 0) {
        setInputError('Portion harus angka bulat lebih dari 0.')
        setInputMessage('')
        return
      }

      const recipe = recipeById[row.recipeId]
      if (!recipe) {
        setInputError('Ada menu yang tidak valid. Pilih ulang menu.')
        setInputMessage('')
        return
      }

      payload.push({
        menuName: recipe.name,
        category: recipe.category,
        portion: portionValue,
        productionDate,
      })
    }

    payload.forEach((item) => addMenuProduction(item))

    setMenuRows([createMenuInputRow()])
    setInputError('')
    setInputMessage('')
    setTimelineMessage(
      `${payload.length} menu masuk ke timeline produksi tanggal ${productionDate} dan diajukan ke Unit Manager (pending approval).`,
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Menu Production
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Rencana produksi mingguan
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Menunggu approval
          </p>
          <h3 className="mt-2 text-xl font-semibold">{productionStats.pending}</h3>
          <p className="mt-3 text-sm text-muted">Menu belum direview Unit Manager.</p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Sudah approved
          </p>
          <h3 className="mt-2 text-xl font-semibold">{productionStats.approved}</h3>
          <p className="mt-3 text-sm text-muted">Menu siap diproses ke Store Request.</p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">
            Total menu
          </p>
          <h3 className="mt-2 text-xl font-semibold text-primary">
            {productionStats.total}
          </h3>
          <p className="mt-3 text-sm text-muted">
            {productionStats.rejected} menu berstatus rejected.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Input Menu Production
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              Input menu yang akan dibuat
            </h3>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Tanggal produksi (pilih sekali)
            </label>
            <input
              type="date"
              value={productionDate}
              onChange={(event) => setProductionDate(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-20 px-2 py-3 font-semibold" />
                <th className="px-4 py-3 font-semibold">Menu</th>
                <th className="px-4 py-3 font-semibold">Kategori</th>
                <th className="px-4 py-3 font-semibold">Portion</th>
              </tr>
            </thead>
            <tbody>
              {menuRows.map((row) => {
                const selectedRecipe = recipeById[row.recipeId]
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveMenuRow(row.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-danger/40 bg-surface text-base font-bold text-danger shadow-sm transition hover:bg-danger hover:text-white hover:shadow-md"
                          aria-label="Hapus baris menu"
                          title="Hapus baris menu"
                        >
                          X
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.recipeId}
                        onChange={(event) =>
                          updateRowRecipe(row.id, event.target.value)
                        }
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      >
                        <option value="">Pilih menu</option>
                        {recipes.map((recipe) => (
                          <option key={recipe.id} value={recipe.id}>
                            {recipe.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {selectedRecipe?.category ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={row.portion === '' ? '' : String(row.portion)}
                        onChange={(event) =>
                          updateRowPortion(row.id, event.target.value)
                        }
                        placeholder="Contoh: 10"
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-border">
                <td colSpan={4} className="px-4 py-3">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleAddMenuRow}
                      className="inline-flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                    >
                      <span>+</span>
                      <span>Tambah menu</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {inputError ? (
              <p className="text-xs font-medium text-red-600">{inputError}</p>
            ) : null}
            {inputMessage ? (
              <p className="text-xs font-medium text-primary">{inputMessage}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleSubmitToTimeline}
            className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Susun & Ajukan ke Unit Manager
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Timeline
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              Menu production tersusun
            </h3>
          </div>
        </div>
        {timelineMessage ? (
          <p className="mt-4 text-xs font-medium text-primary">{timelineMessage}</p>
        ) : null}

        {timelineGroups.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-background p-6 text-center text-sm text-muted">
            Belum ada menu di timeline production.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {timelineGroups.map(([date, items]) => (
              <div
                key={date}
                className="rounded-2xl border border-border bg-background p-4"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  {date}
                </p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                  <table className="min-w-full bg-white text-sm">
                    <thead className="bg-background">
                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                        <th className="px-4 py-3 font-semibold">Menu</th>
                        <th className="px-4 py-3 font-semibold">Kategori</th>
                        <th className="px-4 py-3 font-semibold">Portion</th>
                        <th className="px-4 py-3 font-semibold">Approval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-t border-border">
                          <td className="px-4 py-3">{item.menuName}</td>
                          <td className="px-4 py-3">{item.category}</td>
                          <td className="px-4 py-3">{item.portion}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium">
                              {approvalLabel(item.approvalStatus)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChefMenuCycle
