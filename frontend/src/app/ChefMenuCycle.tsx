import { Fragment, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'

const INPUT_ROWS_PER_PAGE = 8 /* Jumlah baris input menu yang ditampilkan per halaman */

type MenuInputRow = {
  id: string
  recipeId: string
  recipeQuery: string
  portion: number | ''
}/* Tipe data untuk menyimpan informasi setiap baris input menu, termasuk id unik, id resep yang dipilih, query teks untuk pencarian resep, dan jumlah porsi */

const createMenuInputRow = (): MenuInputRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  recipeId: '',
  recipeQuery: '',
  portion: '',
})/* Fungsi untuk membuat baris input menu baru dengan id unik dan nilai default kosong */

const ChefMenuCycle = () => {
  const { recipes, menuProductions, addMenuProductionsBulk } = useChefData()/* Mengambil data resep, produksi menu, dan fungsi untuk menambahkan produksi menu secara bulk dari context ChefData */
  const [productionDate, setProductionDate] = useState('')/* Menyimpan tanggal produksi yang dipilih oleh pengguna untuk input menu */
  const [menuRows, setMenuRows] = useState<MenuInputRow[]>([createMenuInputRow()])/* Menyimpan daftar baris input menu yang sedang diedit oleh pengguna, dengan nilai awal satu baris kosong */
  const [inputError, setInputError] = useState('')/* Menyimpan pesan error yang terkait dengan input menu, seperti validasi atau kesalahan saat submit */
  const [inputMessage, setInputMessage] = useState('')/* Menyimpan pesan informasi yang terkait dengan input menu, seperti keberhasilan penambahan baris atau submit */
  const [expandedMenuRows, setExpandedMenuRows] = useState<string[]>([])/* Menyimpan daftar baris menu yang diperluas untuk menampilkan detail */
  const [inputPage, setInputPage] = useState(1)/* Menyimpan halaman saat ini untuk paginasi baris input menu, dengan nilai awal halaman 1 */

  const normalizeText = (value?: string) => value?.trim().toLowerCase() ?? ''/* Fungsi untuk menormalisasi teks dengan menghapus spasi di awal dan akhir, serta mengubah ke huruf kecil. Digunakan untuk pencarian resep agar lebih fleksibel. */

  const availableRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.approvalStatus === 'approved' && recipe.status === 'active',
      )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  )/* Menghitung daftar resep yang tersedia untuk dipilih dalam input menu, yaitu resep yang sudah disetujui oleh Unit Manager dan berstatus aktif. Hasilnya diurutkan berdasarkan nama resep. Digunakan useMemo untuk menghindari perhitungan ulang yang tidak perlu saat render. */

  const recipeById = useMemo(() => {
    return availableRecipes.reduce<Record<string, (typeof availableRecipes)[number]>>(
      (acc, recipe) => {
        acc[recipe.id] = recipe
        return acc
      },
      {},
    )
  }, [availableRecipes])/* Membuat objek lookup untuk resep berdasarkan id, sehingga memudahkan pencarian informasi resep saat pengguna memilih menu dalam input. Digunakan useMemo untuk menghindari perhitungan ulang yang tidak perlu saat render. */

  useEffect(() => {
    const nextTotalPages = Math.max(1, Math.ceil(menuRows.length / INPUT_ROWS_PER_PAGE))
    setInputPage((prev) => Math.min(prev, nextTotalPages))
  }, [menuRows.length])/* Efek samping untuk memastikan halaman input tetap valid saat jumlah baris menu berubah, terutama saat menambah atau menghapus baris. Jika jumlah baris berkurang sehingga halaman saat ini melebihi total halaman, maka halaman akan disesuaikan ke total halaman yang baru. */

  const toggleMenuRowDetails = (id: string) => {
    setExpandedMenuRows((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }/* Fungsi untuk menambahkan atau menghapus id baris menu dari daftar expandedMenuRows, yang menentukan apakah detail resep untuk baris tersebut ditampilkan atau disembunyikan. */

  const productionStats = useMemo(
    () => ({
      approved: menuProductions.filter(
        (item) => item.approvalStatus === 'approved',
      ).length,
      pending: menuProductions.filter((item) => item.approvalStatus === 'pending')
        .length,
      rejected: menuProductions.filter(
        (item) => item.approvalStatus === 'rejected',
      ).length,
      total: menuProductions.length,
    }),
    [menuProductions],
  )/* Menghitung statistik produksi menu berdasarkan data menuProductions, termasuk jumlah yang disetujui, menunggu persetujuan, ditolak, dan total. Hasilnya digunakan untuk menampilkan informasi ringkasan di bagian atas halaman. Digunakan useMemo untuk menghindari perhitungan ulang yang tidak perlu saat render. */  

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }/* Fungsi untuk memformat nilai kuantitas dengan aturan berikut: jika nilai tidak finite, tampilkan '0'; jika nilai adalah bilangan bulat, tampilkan tanpa desimal; jika nilai memiliki desimal, tampilkan hingga 3 angka di belakang koma dan hapus trailing zero. Digunakan untuk menampilkan jumlah bahan dalam detail resep dengan format yang lebih bersih. */

  const findRecipeByExactQuery = (query: string) => {
    const normalized = normalizeText(query)
    if (!normalized) return undefined
    return availableRecipes.find((recipe) => {
      const name = normalizeText(recipe.name)
      const recipeCode = normalizeText(recipe.recipeCode)
      return name === normalized || recipeCode === normalized
    })
  }/* Fungsi untuk mencari resep yang cocok dengan query pencarian secara tepat, baik berdasarkan nama resep maupun kode resep. Query dan data resep dinormalisasi untuk memastikan pencarian tidak sensitif terhadap spasi atau huruf kapital. Digunakan untuk menentukan apakah input pengguna cocok dengan salah satu resep yang tersedia saat mereka mengetik di kolom menu. */

  const getRecipeSuggestions = (query: string) => {
    const normalized = normalizeText(query)
    const filtered = !normalized
      ? availableRecipes
      : availableRecipes.filter((recipe) => {
          const name = normalizeText(recipe.name)
          const recipeCode = normalizeText(recipe.recipeCode)
          return name.includes(normalized) || recipeCode.includes(normalized)
        })
    return filtered.slice(0, 5)
  }/* Fungsi untuk mendapatkan daftar resep yang cocok dengan query pencarian secara parsial, baik berdasarkan nama resep maupun kode resep. Query dan data resep dinormalisasi untuk memastikan pencarian tidak sensitif terhadap spasi atau huruf kapital. Hasilnya dibatasi maksimal 5 resep untuk ditampilkan sebagai saran saat pengguna mengetik di kolom menu. */

  const updateRowMenuQuery = (id: string, value: string) => {
    const matchedRecipe = findRecipeByExactQuery(value)
    setMenuRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              recipeQuery: value,
              recipeId: matchedRecipe ? matchedRecipe.id : '',
            }
          : row,
      ),
    )
  }/* Fungsi untuk memperbarui query menu dan id resep yang terkait dalam baris input menu saat pengguna mengetik. Fungsi ini mencari apakah query yang dimasukkan cocok dengan salah satu resep yang tersedia secara tepat, dan jika cocok, id resep akan disimpan di state. Jika tidak cocok, id resep akan dikosongkan. Digunakan sebagai onChange handler untuk input menu. */

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
  }/* Fungsi untuk memperbarui nilai porsi dalam baris input menu saat pengguna mengetik. Fungsi ini memastikan bahwa hanya angka yang diterima, dan jika input kosong, nilai porsi akan disimpan sebagai string kosong. Digunakan sebagai onChange handler untuk input porsi. */

  const handleAddMenuRow = () => {
    if (!productionDate) {
      setInputError('Select a production date first.')
      setInputMessage('')
      return
    }

    setMenuRows((prev) => {
      const nextRows = [...prev, createMenuInputRow()]
      const nextTotalPages = Math.max(1, Math.ceil(nextRows.length / INPUT_ROWS_PER_PAGE))
      setInputPage(nextTotalPages)
      return nextRows
    })
    setInputError('')
    setInputMessage('New menu row added.')
  }/* Fungsi untuk menambahkan baris input menu baru ke daftar menuRows saat pengguna mengklik tombol "Add menu". Fungsi ini juga memeriksa apakah tanggal produksi sudah dipilih sebelum menambahkan baris baru, dan jika belum, akan menampilkan pesan error. Setelah menambahkan baris baru, fungsi ini juga menghitung total halaman yang baru dan mengatur halaman saat ini ke halaman terakhir untuk memastikan baris baru terlihat. Digunakan sebagai onClick handler untuk tombol "Add menu". */

  const handleRemoveMenuRow = (id: string) => {
    setMenuRows((prev) => {
      const nextRows = prev.filter((row) => row.id !== id)
      return nextRows.length === 0 ? [createMenuInputRow()] : nextRows
    })
    setInputError('')
    setInputMessage('Menu row removed.')
  }/* Fungsi untuk menghapus baris input menu dari daftar menuRows berdasarkan id saat pengguna mengklik tombol "X" pada baris tersebut. Setelah menghapus, fungsi ini juga memeriksa apakah daftar menuRows menjadi kosong, dan jika ya, akan menambahkan satu baris input menu kosong sebagai gantinya. Digunakan sebagai onClick handler untuk tombol "X" pada setiap baris menu. */

  const handleSubmitToTimeline = async () => {
    if (!productionDate) {
      setInputError('Select a production date first.')
      setInputMessage('')
      return
    }

    const usedRows = menuRows.filter((row) => row.recipeId !== '' || row.portion !== '')

    if (usedRows.length === 0) {
      setInputError('Fill in at least 1 menu row before submitting to the Unit Manager.')
      setInputMessage('')
      return
    }

    const payload: Array<{
      recipeId: string
      menuName: string
      category: string
      portion: number
      cost: number
      productionDate: string
    }> = []

    for (const row of usedRows) {
      if (!row.recipeId || row.portion === '') {
        setInputError('Make sure each row has a menu and portion.')
        setInputMessage('')
        return
      }

      const portionValue = Number(row.portion)
      if (!Number.isInteger(portionValue) || portionValue <= 0) {
        setInputError('Portion must be a whole number greater than 0.')
        setInputMessage('')
        return
      }

      const recipe = recipeById[row.recipeId]
      if (!recipe) {
        setInputError(
          'There is an invalid menu. Only approved recipes can be submitted.',
        )
        setInputMessage('')
        return
      }

      payload.push({
        recipeId: recipe.id,
        menuName: recipe.name,
        category: recipe.category,
        portion: portionValue,
        cost: 0,
        productionDate,
      })
    }

    try {
      await addMenuProductionsBulk(payload)
      setMenuRows([createMenuInputRow()])
      setInputError('')
      setInputMessage(
        `${payload.length} menus submitted for ${productionDate}. The record is now available in Store Request.`,
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save menu production.'
      setInputError(message)
      setInputMessage('')
    }
  }/* Fungsi untuk menangani submit input menu ke Unit Manager. Fungsi ini melakukan validasi pada tanggal produksi, memastikan ada setidaknya satu baris menu yang diisi, dan memeriksa setiap baris untuk memastikan menu dan porsi valid. Jika semua validasi lolos, fungsi ini akan memanggil addMenuProductionsBulk dengan payload yang berisi data produksi menu yang akan disimpan. Setelah berhasil, fungsi ini juga mereset input menu dan menampilkan pesan keberhasilan. Jika terjadi error saat menyimpan, fungsi ini akan menampilkan pesan error yang sesuai. Digunakan sebagai onClick handler untuk tombol "Submit to Unit Manager". */

  const inputTotalPages = Math.max(1, Math.ceil(menuRows.length / INPUT_ROWS_PER_PAGE))
  const paginatedMenuRows = menuRows.slice(
    (inputPage - 1) * INPUT_ROWS_PER_PAGE,
    inputPage * INPUT_ROWS_PER_PAGE,
  )/* Menghitung total halaman untuk paginasi berdasarkan jumlah baris menu dan jumlah baris per halaman. Kemudian, menghitung daftar baris menu yang akan ditampilkan pada halaman saat ini dengan melakukan slicing pada menuRows. Digunakan untuk menampilkan hanya sebagian baris menu sesuai dengan halaman yang dipilih oleh pengguna. */

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Menu Production</h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <h3 className="text-foreground">
              Pending
            </h3>
            <p className="mt-2 text-xl font-semibold">
              {productionStats.pending}
            </p>
            <p className="mt-3 text-sm text-foreground">
              Menus awaiting Unit Manager approval.
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <h3 className="text-foreground">
              Approved
            </h3>
            <p className="mt-2 text-xl font-semibold">
              {productionStats.approved}
            </p>
            <p className="mt-3 text-sm text-foreground">
              Menus ready for Store Request.
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <h3 className="text-foreground">
              Total menus
            </h3>
            <p className="mt-2 text-xl font-semibold text-foreground">
              {productionStats.total}
            </p>
            <p className="mt-3 text-sm text-foreground">
              {productionStats.rejected} menus are rejected.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="font-semibold text-foreground">
              Production input
            </h3>
            <p className="mt-1 text-xs text-muted">
              Enter menus to be produced
            </p>
            <p className="mt-3 text-xs text-muted">
              Only recipes approved by the Unit Manager can be selected.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted">
              Production date (pick once)
            </label>
            <input
              type="date"
              value={productionDate}
              onChange={(event) => setProductionDate(event.target.value)}
              className="mt-2 w-full max-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
        </div>

        <div className="mt-6 max-w-full overflow-x-auto rounded-md border border-border">
          <TablePagination
            page={inputPage}
            totalPages={inputTotalPages}
            onPageChange={setInputPage}
            summary={`Showing ${paginatedMenuRows.length} of ${menuRows.length} menu rows`}
            className="rounded-t-md border-b border-border bg-white px-4 py-3"
          />
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-20 px-2 py-3 font-semibold" />
                <th className="w-14 px-2 py-3 font-semibold text-center">No</th>
                <th className="px-4 py-3 font-semibold">Recipe ID</th>
                <th className="px-4 py-3 font-semibold">Menu</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Portion</th>
                <th className="px-4 py-3 font-semibold">Recipe details</th>
              </tr>
            </thead>
            <tbody>
              {paginatedMenuRows.map((row, index) => {
                const selectedRecipe = recipeById[row.recipeId]
                const isDetailsOpen = expandedMenuRows.includes(row.id)
                const ingredients = selectedRecipe?.ingredients ?? []
                const basePax =
                  selectedRecipe && selectedRecipe.portionSize > 0
                    ? selectedRecipe.portionSize
                    : 1
                const portionForPreview =
                  typeof row.portion === 'number' && row.portion > 0
                    ? row.portion
                    : null
                const recipeSuggestions = getRecipeSuggestions(row.recipeQuery)
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-border">
                      <td className="px-2 py-3">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveMenuRow(row.id)}
                            className="dm-x-button text-sm font-semibold leading-none"
                            aria-label="Remove menu row"
                            title="Remove menu row"
                          >
                            X
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center text-sm text-muted">
                        {(inputPage - 1) * INPUT_ROWS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {selectedRecipe?.recipeCode ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          list={`menu-options-${row.id}`}
                          value={row.recipeQuery}
                          onChange={(event) =>
                            updateRowMenuQuery(row.id, event.target.value)
                          }
                          placeholder={
                            availableRecipes.length === 0
                              ? 'No approved menu available'
                              : 'Search menu'
                          }
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        />
                        <datalist id={`menu-options-${row.id}`}>
                          {recipeSuggestions.map((recipe) => (
                            <option
                              key={recipe.id}
                              value={recipe.name}
                              label={recipe.category}
                            />
                          ))}
                        </datalist>
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
                          placeholder="Example: 10"
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          disabled={!selectedRecipe}
                          onClick={() => {
                            if (!selectedRecipe) return
                            toggleMenuRowDetails(row.id)
                          }}
                          className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-expanded={isDetailsOpen}
                        >
                          {isDetailsOpen ? 'Hide details' : 'View details'}
                        </button>
                      </td>
                    </tr>
                    {isDetailsOpen ? (
                      <tr className="border-t border-border bg-background">
                        <td colSpan={7} className="px-4 py-4">
                          {!selectedRecipe ? (
                            <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
                              Select a menu to view recipe details.
                            </div>
                          ) : (
                            <div className="rounded-md border border-border bg-surface p-4">
                                <h3 className="font-semibold text-foreground">
                                  Ingredients
                                </h3>
                                <p className="mt-1 text-xs text-muted">
                                  Recipe ingredients
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                  {portionForPreview === null
                                    ? `Qty listed per base pax (${basePax}). Enter portion to preview calculated qty.`
                                    : `Qty calculated from base pax (${basePax}) for ${portionForPreview} portions.`}
                                </p>
                                {ingredients.length === 0 ? (
                                  <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                    No ingredients for this recipe yet.
                                  </div>
                                ) : (
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-4 py-3 font-semibold">
                                            No
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Product code
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Ingredient name
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Qty
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Unit
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {ingredients.map((ingredient, idx) => {
                                          const scaledQty =
                                            portionForPreview === null
                                              ? ingredient.qty
                                              : (ingredient.qty * portionForPreview) /
                                                basePax
                                          return (
                                            <tr
                                              key={`${ingredient.productCode}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.productCode}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.name}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(scaledQty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(
                                                  ingredient.unitOfMeasures,
                                                )}
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
              <tr className="border-t border-border">
                <td colSpan={8} className="px-4 py-3">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleAddMenuRow}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                    >
                      <span>+</span>
                      <span>Add menu</span>
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
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Submit to Unit Manager
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChefMenuCycle

