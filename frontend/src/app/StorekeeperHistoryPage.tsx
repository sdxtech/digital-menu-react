import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'

const navItems = [
  { label: 'Storekeeper Dashboard', to: '/storekeeper' },
  { label: 'Riwayat Pengeluaran', to: '/storekeeper/history' },
]

const StorekeeperHistoryPage = () => {
  const { user, logout } = useAuth()
  const { menuProductions, recipes, fetchMenuProductions, fetchRecipes } =
    useChefData()
  const navigate = useNavigate()
  const [loadError, setLoadError] = useState('')

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    setLoadError('')
    Promise.all([fetchMenuProductions(), fetchRecipes()]).catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Gagal memuat data.'
      setLoadError(message)
    })
  }, [fetchMenuProductions, fetchRecipes])

  const fulfilledMenus = useMemo(
    () =>
      menuProductions.filter(
        (item) =>
          item.approvalStatus === 'approved' &&
          item.storeRequestStatus === 'fulfilled',
      ),
    [menuProductions],
  )

  const groupedByDate = useMemo(() => {
    const map = new Map<string, typeof fulfilledMenus>()
    fulfilledMenus.forEach((item) => {
      const date = item.productionDate
      const bucket = map.get(date)
      if (bucket) {
        bucket.push(item)
      } else {
        map.set(date, [item])
      }
    })
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [fulfilledMenus])

  const recipeByName = useMemo(() => {
    const map = new Map<string, (typeof recipes)[number]>()
    recipes.forEach((recipe) => {
      map.set(recipe.name.trim().toLowerCase(), recipe)
    })
    return map
  }, [recipes])

  const summaryByDate = useMemo(() => {
    return groupedByDate.map(([date, items]) => {
      const summary = new Map<
        string,
        { productCode: string; name: string; unit: string; qty: number }
      >()
      const missingRecipes: string[] = []

      items.forEach((menu) => {
        const recipe = recipeByName.get(menu.menuName.trim().toLowerCase())
        if (!recipe) {
          missingRecipes.push(menu.menuName)
          return
        }
        const base = Number(recipe.portionSize) || 1
        const multiplier = Number(menu.portion) / base
        recipe.ingredients.forEach((ingredient) => {
          const key = `${ingredient.productCode}__${ingredient.unitOfMeasures}`
          const existing = summary.get(key)
          const qty = Number(ingredient.qty) * multiplier
          if (existing) {
            existing.qty += qty
          } else {
            summary.set(key, {
              productCode: ingredient.productCode,
              name: ingredient.name,
              unit: ingredient.unitOfMeasures,
              qty,
            })
          }
        })
      })

      return {
        date,
        items,
        summary: Array.from(summary.values()),
        missingRecipes,
      }
    })
  }, [groupedByDate, recipeByName])

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_12px_30px_rgba(11,41,87,0.25)]">
              SK
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Storekeeper Workspace
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Riwayat Pengeluaran
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border bg-surface px-4 py-2 text-xs font-medium text-muted shadow-sm">
              {user?.email ?? 'storekeeper@brand.com'}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-xs font-semibold text-primary shadow-sm transition hover:bg-primary-soft"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Role
              </p>
              <h2 className="mt-2 text-lg font-semibold">Storekeeper</h2>
              <p className="mt-3 text-xs text-muted">
                Lihat riwayat pengeluaran bahan untuk dapur.
              </p>
            </div>

            <nav className="mt-5 space-y-2 rounded-3xl border border-border bg-surface p-4 shadow-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      'flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition',
                      isActive
                        ? 'bg-primary text-white shadow-[0_12px_30px_rgba(11,41,87,0.25)]'
                        : 'bg-background text-foreground hover:bg-primary-soft',
                    ].join(' ')
                  }
                >
                  <span>{item.label}</span>
                  <span className="text-xs opacity-70">-&gt;</span>
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="space-y-6 lg:col-span-9">
            <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Riwayat
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Menu produksi yang sudah dikirim ke dapur
              </h2>
              <p className="mt-3 text-sm text-muted">
                Data ini berisi pengeluaran bahan yang sudah selesai.
              </p>
              {loadError ? (
                <p className="mt-3 text-xs font-medium text-red-600">
                  {loadError}
                </p>
              ) : null}
            </div>

            {summaryByDate.length === 0 ? (
              <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-muted shadow-sm">
                Belum ada riwayat pengeluaran bahan.
              </div>
            ) : (
              summaryByDate.map((group) => (
                <div
                  key={group.date}
                  className="rounded-3xl border border-border bg-surface p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-muted">
                        Tanggal produksi
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">{group.date}</h3>
                    </div>
                    <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                      {group.items.length} menu
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-12">
                    <div className="rounded-2xl border border-border bg-background p-4 lg:col-span-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">
                        Daftar menu
                      </p>
                      <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-background">
                            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                              <th className="px-4 py-3 font-semibold">Menu</th>
                              <th className="px-4 py-3 font-semibold">Kategori</th>
                              <th className="px-4 py-3 font-semibold">Portion</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((menu) => (
                              <tr key={menu.id} className="border-t border-border">
                                <td className="px-4 py-3">{menu.menuName}</td>
                                <td className="px-4 py-3">{menu.category}</td>
                                <td className="px-4 py-3">{menu.portion}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {group.missingRecipes.length > 0 ? (
                        <p className="mt-3 text-xs text-danger">
                          Recipe tidak ditemukan untuk: {group.missingRecipes.join(', ')}
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-border bg-background p-4 lg:col-span-7">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">
                        Ringkasan bahan
                      </p>
                      <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-background">
                            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                              <th className="px-4 py-3 font-semibold">Product code</th>
                              <th className="px-4 py-3 font-semibold">Nama bahan</th>
                              <th className="px-4 py-3 font-semibold">Qty</th>
                              <th className="px-4 py-3 font-semibold">Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.summary.length === 0 ? (
                              <tr className="border-t border-border">
                                <td
                                  colSpan={4}
                                  className="px-4 py-6 text-center text-muted"
                                >
                                  Belum ada ingredient yang bisa dihitung.
                                </td>
                              </tr>
                            ) : (
                              group.summary.map((item) => (
                                <tr
                                  key={`${item.productCode}-${item.unit}`}
                                  className="border-t border-border"
                                >
                                  <td className="px-4 py-3">
                                    {item.productCode}
                                  </td>
                                  <td className="px-4 py-3">{item.name}</td>
                                  <td className="px-4 py-3">
                                    {formatQuantity(item.qty)}
                                  </td>
                                  <td className="px-4 py-3">{item.unit}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default StorekeeperHistoryPage
