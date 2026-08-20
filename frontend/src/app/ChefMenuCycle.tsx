import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import ActionButton from '../components/ActionButton'
import { apiFetch } from '../lib/api'
import { useChefData, type MenuProduction, type Recipe } from '../lib/chef-data'
import { useAuth } from '../lib/auth'
import { formatQuantity } from '../lib/quantity'
import { formatVersionedRecipeName } from '../lib/recipe-version'
import { formatUnitLabel } from '../lib/unit-of-measures'

const INPUT_ROWS_PER_PAGE = 8 /* Jumlah baris input menu yang ditampilkan per halaman */
const USE_OTHER_SITE_VENDOR_OPTION = '__use_other_site_vendor__'

type ProductionSiteOption = {
  code: string
  name: string
}

type ProductionUserOption = {
  id: string
  name: string
  email: string
  roles: string[]
}

type ProductionClientOption = {
  id: string
  name: string
  clientId: string
}

type ProductionClientApi = {
  id?: string
  _id?: string
  name?: string
  clientId?: string
}

type ProductionUserApi = {
  id?: string
  _id?: string
  name?: string
  email?: string
  roles?: string[]
  isActive?: boolean
}

type RawMaterialVendorPriceApi = {
  id?: string
  _id?: string
  productCode?: string
  site?: string
  vendor?: string
  currency?: string
  unitOfMeasures?: string
  minimumQuantity?: number
  price?: number
  priceQuantity?: number
}

type RawMaterialVendorPriceOption = {
  key: string
  productCode: string
  site: string
  vendor: string
  currency?: string
  unitOfMeasures: string
  minimumQuantity?: number
  price?: number
  priceQuantity?: number
}

type MenuInputRow = {
  id: string
  recipeId: string
  recipeQuery: string
  portion: number | ''
}/* Tipe data untuk menyimpan informasi setiap baris input menu, termasuk id unik, id resep yang dipilih, query teks untuk pencarian resep, dan jumlah porsi */

type MenuProductionIngredientVendorInput = {
  ingredientIndex: number
  productCode?: string
  name?: string
  unitOfMeasures?: string
  vendor?: string
  site?: string
  currency?: string
  minimumQuantity?: number
  price?: number
}

const createMenuInputRow = (): MenuInputRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  recipeId: '',
  recipeQuery: '',
  portion: '',
})/* Fungsi untuk membuat baris input menu baru dengan id unik dan nilai default kosong */

const mapProductionUser = (item: ProductionUserApi): ProductionUserOption => ({
  id: item.id ?? item._id ?? '',
  name: item.name ?? '',
  email: item.email ?? '',
  roles: item.roles ?? [],
})

type ChefMenuCycleProps = {
  embedded?: boolean
  title?: string
  description?: string
  requireProductionSite?: boolean
  productionSiteOptions?: ProductionSiteOption[]
  requireProductionActors?: boolean
  submitLabel?: string
  emptySiteMessage?: string
  showEstimatedCostColumns?: boolean
  showIngredientCostColumns?: boolean
  showIngredientVendorColumn?: boolean
  allowIngredientCostSync?: boolean
}

const getVendorUnitPrice = (option?: RawMaterialVendorPriceOption) => {
  const price = Number(option?.price)
  if (!Number.isFinite(price)) return undefined
  const priceQuantity = Number(option?.priceQuantity)
  return price /
    (Number.isFinite(priceQuantity) && priceQuantity > 0 ? priceQuantity : 1)
}

const ChefMenuCycle = ({
  embedded = false,
  title = 'Menu Production',
  description,
  requireProductionSite = false,
  productionSiteOptions = [],
  requireProductionActors = false,
  submitLabel = 'Submit',
  emptySiteMessage = 'Select a production site first.',
  showEstimatedCostColumns = false,
  showIngredientCostColumns = false,
  showIngredientVendorColumn = false,
  allowIngredientCostSync = false,
}: ChefMenuCycleProps = {}) => {
  const { accessToken, user } = useAuth()
  const {
    recipes,
    menuProductions,
    addMenuProductionsBulk,
    fetchRecipes,
  } = useChefData()/* Mengambil data resep, produksi menu, dan fungsi untuk menambahkan produksi menu secara bulk dari context ChefData */
  const [productionSite, setProductionSite] = useState('')
  const [productionClientId, setProductionClientId] = useState('')
  const [productionClients, setProductionClients] = useState<
    ProductionClientOption[]
  >([])
  const [productionClientLoading, setProductionClientLoading] = useState(false)
  const [loadedProductionSite, setLoadedProductionSite] = useState('')
  const [siteRecipes, setSiteRecipes] = useState<Recipe[]>([])
  const [siteMenuProductions, setSiteMenuProductions] = useState<
    MenuProduction[]
  >([])
  const [siteUsers, setSiteUsers] = useState<ProductionUserOption[]>([])
  const [productionChefId, setProductionChefId] = useState('')
  const [productionUnitManagerId, setProductionUnitManagerId] = useState('')
  const [siteDataLoading, setSiteDataLoading] = useState(false)
  const [siteDataError, setSiteDataError] = useState('')
  const [costSyncLoading, setCostSyncLoading] = useState(false)
  const [costSyncMessage, setCostSyncMessage] = useState('')
  const [costSyncError, setCostSyncError] = useState('')
  const [vendorPricesByProductKey, setVendorPricesByProductKey] = useState<
    Record<string, RawMaterialVendorPriceOption[]>
  >({})
  const [vendorPriceLoadingByProductKey, setVendorPriceLoadingByProductKey] =
    useState<Record<string, boolean>>({})
  const [vendorPriceErrorByProductKey, setVendorPriceErrorByProductKey] =
    useState<Record<string, string>>({})
  const [selectedVendorPriceByIngredientKey, setSelectedVendorPriceByIngredientKey] =
    useState<Record<string, string>>({})
  const [customPriceByIngredientKey, setCustomPriceByIngredientKey] =
    useState<Record<string, string>>({})
  const [otherSiteVendorPricesByProductKey, setOtherSiteVendorPricesByProductKey] =
    useState<Record<string, RawMaterialVendorPriceOption[]>>({})
  const [otherSiteVendorPriceLoadedByProductKey, setOtherSiteVendorPriceLoadedByProductKey] =
    useState<Record<string, boolean>>({})
  const [
    otherSiteVendorPriceLoadingByProductKey,
    setOtherSiteVendorPriceLoadingByProductKey,
  ] = useState<Record<string, boolean>>({})
  const [otherSiteVendorPriceErrorByProductKey, setOtherSiteVendorPriceErrorByProductKey] =
    useState<Record<string, string>>({})
  const [useOtherSiteVendorByIngredientKey, setUseOtherSiteVendorByIngredientKey] =
    useState<Record<string, boolean>>({})
  const [productionDate, setProductionDate] = useState('')/* Menyimpan tanggal produksi yang dipilih oleh pengguna untuk input menu */
  const [menuRows, setMenuRows] = useState<MenuInputRow[]>([createMenuInputRow()])/* Menyimpan daftar baris input menu yang sedang diedit oleh pengguna, dengan nilai awal satu baris kosong */
  const [inputError, setInputError] = useState('')/* Menyimpan pesan error yang terkait dengan input menu, seperti validasi atau kesalahan saat submit */
  const [inputMessage, setInputMessage] = useState('')/* Menyimpan pesan informasi yang terkait dengan input menu, seperti keberhasilan penambahan baris atau submit */
  const [expandedMenuRows, setExpandedMenuRows] = useState<string[]>([])/* Menyimpan daftar baris menu yang diperluas untuk menampilkan detail */
  const [inputPage, setInputPage] = useState(1)/* Menyimpan halaman saat ini untuk paginasi baris input menu, dengan nilai awal halaman 1 */
  const [activeRecipeDropdownId, setActiveRecipeDropdownId] = useState<string | null>(null)
  const [recipeDropdownPosition, setRecipeDropdownPosition] = useState<{
    left: number
    top: number
  } | null>(null)

  const normalizeText = useCallback(
    (value?: string) => value?.trim().toLowerCase() ?? '',
    [],
  )/* Fungsi untuk menormalisasi teks dengan menghapus spasi di awal dan akhir, serta mengubah ke huruf kecil. Digunakan untuk pencarian resep agar lebih fleksibel. */
  const chefProductionSite = useMemo(() => {
    if (requireProductionSite) return ''
    return user?.siteName?.trim() || user?.site?.trim() || ''
  }, [requireProductionSite, user?.site, user?.siteName])
  const getVendorPricesProductKey = useCallback(
    (productCode?: string) =>
      `${productionSite || chefProductionSite || 'all'}::${normalizeText(
        productCode,
      )}`,
    [chefProductionSite, normalizeText, productionSite],
  )
  const getIngredientVendorSelectionKey = useCallback(
    (rowId: string, index: number, productCode?: string) =>
      `${rowId}::${index}::${normalizeText(productCode)}`,
    [normalizeText],
  )

  const formatPrice = (value?: number) => {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      return '-'
    }
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(value)
  }

  const mapVendorPriceOption = useCallback(
    (item: RawMaterialVendorPriceApi): RawMaterialVendorPriceOption | null => {
      const productCode = item.productCode?.trim() ?? ''
      const site = item.site?.trim() ?? ''
      const vendor = item.vendor?.trim() ?? ''
      const unitOfMeasures = item.unitOfMeasures?.trim() ?? ''
      if (!productCode || !site || !vendor || !unitOfMeasures) return null

      const minimumQuantity = Number.isFinite(Number(item.minimumQuantity))
        ? Number(item.minimumQuantity)
        : undefined
      const price = Number.isFinite(Number(item.price))
        ? Number(item.price)
        : undefined
      const priceQuantity =
        Number.isFinite(Number(item.priceQuantity)) &&
        Number(item.priceQuantity) > 0
          ? Number(item.priceQuantity)
          : undefined
      const currency = item.currency?.trim() || undefined
      const key = [
        normalizeText(productCode),
        normalizeText(site),
        normalizeText(vendor),
        normalizeText(currency),
        normalizeText(unitOfMeasures),
        minimumQuantity ?? '',
        price ?? '',
        priceQuantity ?? '',
      ].join('|')

      return {
        key,
        productCode,
        site,
        vendor,
        currency,
        unitOfMeasures,
        minimumQuantity,
        price,
        priceQuantity,
      }
    },
    [normalizeText],
  )

  const formatVendorPriceLabel = (option: RawMaterialVendorPriceOption) => {
    return option.vendor
  }

  const sortVendorPriceOptions = useCallback(
    (options: RawMaterialVendorPriceOption[]) =>
      options.sort((a, b) =>
        [a.vendor, a.site, String(a.minimumQuantity ?? '')]
          .join(' ')
          .localeCompare(
            [b.vendor, b.site, String(b.minimumQuantity ?? '')].join(' '),
            undefined,
            { sensitivity: 'base' },
          ),
      ),
    [],
  )

  const pickDefaultVendorPriceOption = (
    options: RawMaterialVendorPriceOption[],
  ) => {
    if (options.length === 0) return undefined

    return options.reduce((selected, option) => {
      const selectedPrice = Number(getVendorUnitPrice(selected))
      const optionPrice = Number(getVendorUnitPrice(option))
      const selectedHasPrice = Number.isFinite(selectedPrice)
      const optionHasPrice = Number.isFinite(optionPrice)

      if (optionHasPrice && !selectedHasPrice) return option
      if (optionHasPrice && selectedHasPrice && optionPrice > selectedPrice) {
        return option
      }
      return selected
    }, options[0])
  }

  const getSelectedVendorPriceKey = (
    selectionKey: string,
    options: RawMaterialVendorPriceOption[],
  ) => {
    const selectedKey = selectedVendorPriceByIngredientKey[selectionKey]
    if (selectedKey && options.some((option) => option.key === selectedKey)) {
      return selectedKey
    }
    return pickDefaultVendorPriceOption(options)?.key ?? ''
  }

  const getSelectedOtherSiteVendorPriceKey = (
    selectionKey: string,
    options: RawMaterialVendorPriceOption[],
  ) => {
    const selectedKey = selectedVendorPriceByIngredientKey[selectionKey]
    if (selectedKey && options.some((option) => option.key === selectedKey)) {
      return selectedKey
    }
    return ''
  }

  const dedupeVendorPricesByVendor = useCallback(
    (options: RawMaterialVendorPriceOption[]) => {
      const byVendor = new Map<string, RawMaterialVendorPriceOption>()
      options.forEach((option) => {
        const vendorKey = normalizeText(option.vendor)
        if (!vendorKey) return

        const existing = byVendor.get(vendorKey)
        if (!existing) {
          byVendor.set(vendorKey, option)
          return
        }

        const existingPrice = Number(getVendorUnitPrice(existing))
        const optionPrice = Number(getVendorUnitPrice(option))
        const existingHasPrice = Number.isFinite(existingPrice)
        const optionHasPrice = Number.isFinite(optionPrice)
        if (
          optionHasPrice &&
          (!existingHasPrice || optionPrice > existingPrice)
        ) {
          byVendor.set(vendorKey, option)
        }
      })
      return sortVendorPriceOptions(Array.from(byVendor.values()))
    },
    [normalizeText, sortVendorPriceOptions],
  )

  const getIngredientUnitPrice = (
    ingredient: Recipe['ingredients'][number],
    vendorPrice?: RawMaterialVendorPriceOption,
  ) => {
    if (Number.isFinite(getVendorUnitPrice(vendorPrice))) {
      return getVendorUnitPrice(vendorPrice)
    }
    if (Number.isFinite(Number(ingredient.priceUom))) {
      return Number(ingredient.priceUom)
    }
    if (
      Number.isFinite(Number(ingredient.foodCost)) &&
      Number.isFinite(Number(ingredient.qty)) &&
      Number(ingredient.qty) > 0
    ) {
      return Number(ingredient.foodCost) / Number(ingredient.qty)
    }
    return undefined
  }

  const getNmpUnitPrice = (
    _ingredient: Recipe['ingredients'][number],
    selectionKey: string,
  ) => {
    const enteredPrice = customPriceByIngredientKey[selectionKey]
    if (enteredPrice === undefined || enteredPrice.trim() === '') {
      return undefined
    }
    const parsedPrice = Number(enteredPrice)
    return Number.isFinite(parsedPrice) && parsedPrice >= 0
      ? parsedPrice
      : undefined
  }

  const sortedProductionSiteOptions = useMemo(
    () =>
      productionSiteOptions
        .filter((site) => site.code.trim())
        .slice()
        .sort((a, b) =>
          (a.name || a.code).localeCompare(b.name || b.code, undefined, {
            sensitivity: 'base',
          }),
        ),
    [productionSiteOptions],
  )
  const selectedProductionSiteName = useMemo(
    () =>
      sortedProductionSiteOptions
        .find((site) => site.code === productionSite)
        ?.name.trim() ?? '',
    [productionSite, sortedProductionSiteOptions],
  )
  const getRecipeSiteText = (recipe: Recipe) =>
    recipe.siteName?.trim() || recipe.site?.trim() || 'All sites'

  const siteDataReady =
    !requireProductionSite ||
    (Boolean(productionSite) && loadedProductionSite === productionSite)
  const scopedRecipes = useMemo(() => {
    if (!requireProductionSite) return recipes
    return siteDataReady ? siteRecipes : []
  }, [recipes, requireProductionSite, siteDataReady, siteRecipes])
  const scopedMenuProductions = useMemo(() => {
    if (!requireProductionSite) return menuProductions
    return siteDataReady ? siteMenuProductions : []
  }, [
    menuProductions,
    requireProductionSite,
    siteDataReady,
    siteMenuProductions,
  ])

  const loadOtherSiteVendorPrices = useCallback(
    async (productCode?: string) => {
      const trimmedProductCode = productCode?.trim()
      if (!trimmedProductCode || !accessToken) return

      const productKey = getVendorPricesProductKey(trimmedProductCode)
      if (
        otherSiteVendorPriceLoadedByProductKey[productKey] ||
        otherSiteVendorPriceLoadingByProductKey[productKey]
      ) {
        return
      }

      setOtherSiteVendorPriceLoadingByProductKey((prev) => ({
        ...prev,
        [productKey]: true,
      }))
      setOtherSiteVendorPriceErrorByProductKey((prev) => ({
        ...prev,
        [productKey]: '',
      }))

      try {
        const items = await apiFetch<RawMaterialVendorPriceApi[]>(
          `/raw-materials/${encodeURIComponent(trimmedProductCode)}/vendor-prices`,
          undefined,
          accessToken,
        )
        const options = dedupeVendorPricesByVendor(
          items
            .map(mapVendorPriceOption)
            .filter(
              (option): option is RawMaterialVendorPriceOption =>
                Boolean(option),
            ),
        )
        setOtherSiteVendorPricesByProductKey((prev) => ({
          ...prev,
          [productKey]: options,
        }))
        setOtherSiteVendorPriceLoadedByProductKey((prev) => ({
          ...prev,
          [productKey]: true,
        }))
      } catch (error) {
        setOtherSiteVendorPriceErrorByProductKey((prev) => ({
          ...prev,
          [productKey]:
            error instanceof Error
              ? error.message
              : 'Failed to load other site vendors.',
        }))
      } finally {
        setOtherSiteVendorPriceLoadingByProductKey((prev) => ({
          ...prev,
          [productKey]: false,
        }))
      }
    },
    [
      accessToken,
      dedupeVendorPricesByVendor,
      getVendorPricesProductKey,
      mapVendorPriceOption,
      otherSiteVendorPriceLoadedByProductKey,
      otherSiteVendorPriceLoadingByProductKey,
    ],
  )
  const chefOptions = useMemo(
    () =>
      siteUsers
        .filter((user) => user.roles.includes('chef'))
        .sort((a, b) =>
          (a.name || a.email).localeCompare(b.name || b.email, undefined, {
            sensitivity: 'base',
          }),
        ),
    [siteUsers],
  )
  const unitManagerOptions = useMemo(
    () =>
      siteUsers
        .filter((user) => user.roles.includes('unit-manager'))
        .sort((a, b) =>
          (a.name || a.email).localeCompare(b.name || b.email, undefined, {
            sensitivity: 'base',
          }),
        ),
    [siteUsers],
  )

  const availableRecipes = useMemo(
    () =>
      scopedRecipes.filter(
        (recipe) =>
          recipe.approvalStatus === 'approved' && recipe.status === 'active',
      )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [scopedRecipes],
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

  useEffect(() => {
    if (embedded || !accessToken || !user?.site) return

    apiFetch(
      '/notifications/mark-role-read',
      {
        method: 'PATCH',
        body: JSON.stringify({
          siteCode: user.site,
          targetUserRole: 'chef',
          componentKey: 'MENU_PRODUCTION_RECORDS',
        }),
      },
      accessToken,
    )
      .then(() => window.dispatchEvent(new CustomEvent('refresh-notifications')))
      .catch((err) =>
        console.error('Failed to clear legacy chef menu production badges:', err),
      )
  }, [accessToken, embedded, user?.site])

  useEffect(() => {
    if (!requireProductionSite) return
    setMenuRows([createMenuInputRow()])
    setExpandedMenuRows([])
    setInputPage(1)
    setInputError('')
    setInputMessage('')
    setProductionChefId('')
    setProductionUnitManagerId('')
    setProductionClientId('')
    setProductionClients([])
    setVendorPricesByProductKey({})
    setVendorPriceLoadingByProductKey({})
    setVendorPriceErrorByProductKey({})
    setSelectedVendorPriceByIngredientKey({})
  }, [productionSite, requireProductionSite])

  const clientSiteCode = requireProductionSite
    ? productionSite
    : user?.site?.trim() ?? ''

  useEffect(() => {
    if (!accessToken || !clientSiteCode) {
      setProductionClients([])
      setProductionClientId('')
      setProductionClientLoading(false)
      return
    }

    let cancelled = false
    setProductionClientLoading(true)
    apiFetch<{ items?: ProductionClientApi[] }>(
      `/clients/by-site/${encodeURIComponent(clientSiteCode)}`,
      undefined,
      accessToken,
    )
      .then((data) => {
        if (cancelled) return
        setProductionClients(
          (data.items ?? [])
            .map((client) => ({
              id: client.id ?? client._id ?? '',
              name: client.name ?? '',
              clientId: client.clientId ?? '',
            }))
            .filter((client) => client.id && client.name && client.clientId)
            .sort((first, second) => {
              const clientIdOrder = first.clientId.localeCompare(second.clientId, undefined, {
                numeric: true,
                sensitivity: 'base',
              })
              return clientIdOrder || first.name.localeCompare(second.name, undefined, {
                sensitivity: 'base',
              })
            }),
        )
      })
      .catch(() => {
        if (!cancelled) setProductionClients([])
      })
      .finally(() => {
        if (!cancelled) setProductionClientLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, clientSiteCode])

  useEffect(() => {
    if (!requireProductionSite) return

    if (!productionSite) {
      setLoadedProductionSite('')
      setSiteRecipes([])
      setSiteMenuProductions([])
      setSiteUsers([])
      setSiteDataError('')
      setSiteDataLoading(false)
      return
    }

    let cancelled = false
    setSiteDataLoading(true)
    setSiteDataError('')
    Promise.all([
      fetchRecipes({ site: productionSite }),
      accessToken
        ? apiFetch<{ items?: ProductionUserApi[] }>(
            `/superadmin/users?site=${encodeURIComponent(
              productionSite,
            )}&limit=100`,
            undefined,
            accessToken,
          )
        : Promise.resolve({ items: [] }),
    ])
      .then(([nextRecipes, userData]) => {
        if (cancelled) return
        setSiteRecipes(nextRecipes)
        setSiteMenuProductions([])
        setSiteUsers(
          (userData.items ?? [])
            .filter((user) => user.isActive !== false)
            .map(mapProductionUser)
            .filter((user) => user.id),
        )
        setLoadedProductionSite(productionSite)
      })
      .catch((error) => {
        if (cancelled) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load menu production data.'
        setLoadedProductionSite('')
        setSiteRecipes([])
        setSiteMenuProductions([])
        setSiteUsers([])
        setSiteDataError(message)
      })
      .finally(() => {
        if (cancelled) return
        setSiteDataLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, fetchRecipes, productionSite, requireProductionSite])

  useEffect(() => {
    if (!showIngredientVendorColumn || !accessToken) return

    const productCodes = new Set<string>()
    menuRows.forEach((row) => {
      const recipe = recipeById[row.recipeId]
      ;(recipe?.ingredients ?? []).forEach((ingredient) => {
        if (ingredient.productCode?.trim()) {
          productCodes.add(ingredient.productCode.trim())
        }
      })
    })

    productCodes.forEach((productCode) => {
      const productKey = getVendorPricesProductKey(productCode)
      if (
        vendorPricesByProductKey[productKey] ||
        vendorPriceLoadingByProductKey[productKey]
      ) {
        return
      }

      setVendorPriceLoadingByProductKey((prev) => ({
        ...prev,
        [productKey]: true,
      }))
      setVendorPriceErrorByProductKey((prev) => ({
        ...prev,
        [productKey]: '',
      }))

      const fetchVendorPrices = async (site?: string) => {
        const params = new URLSearchParams()
        if (site?.trim()) params.set('site', site.trim())
        const query = params.toString()
        return apiFetch<RawMaterialVendorPriceApi[]>(
          `/raw-materials/${encodeURIComponent(productCode)}/vendor-prices${
            query ? `?${query}` : ''
          }`,
          undefined,
          accessToken,
        )
      }

      ;(async () => {
        try {
          const vendorPriceSite =
            selectedProductionSiteName || productionSite || chefProductionSite
          const items = vendorPriceSite
            ? await fetchVendorPrices(vendorPriceSite)
            : await fetchVendorPrices()
          const byKey = new Map<string, RawMaterialVendorPriceOption>()
          items.forEach((item) => {
            const option = mapVendorPriceOption(item)
            if (option) byKey.set(option.key, option)
          })
          const options = sortVendorPriceOptions(Array.from(byKey.values()))
          setVendorPricesByProductKey((prev) => ({
            ...prev,
            [productKey]: options,
          }))
        } catch (error) {
          setVendorPriceErrorByProductKey((prev) => ({
            ...prev,
            [productKey]:
              error instanceof Error
                ? error.message
                : 'Failed to load vendors.',
          }))
        } finally {
          setVendorPriceLoadingByProductKey((prev) => ({
            ...prev,
            [productKey]: false,
          }))
        }
      })()
    })
  }, [
    accessToken,
    chefProductionSite,
    getVendorPricesProductKey,
    mapVendorPriceOption,
    menuRows,
    productionSite,
    recipeById,
    selectedProductionSiteName,
    showIngredientVendorColumn,
    sortVendorPriceOptions,
    vendorPriceLoadingByProductKey,
    vendorPricesByProductKey,
  ])

  useEffect(() => {
    if (!showIngredientVendorColumn || !accessToken) return

    expandedMenuRows.forEach((rowId) => {
      const row = menuRows.find((item) => item.id === rowId)
      const recipe = row ? recipeById[row.recipeId] : undefined
      ;(recipe?.ingredients ?? []).forEach((ingredient, idx) => {
        const vendorSelectionKey = getIngredientVendorSelectionKey(
          rowId,
          idx,
          ingredient.productCode,
        )
        if (!useOtherSiteVendorByIngredientKey[vendorSelectionKey]) return
        loadOtherSiteVendorPrices(ingredient.productCode).catch(() => null)
      })
    })
  }, [
    accessToken,
    expandedMenuRows,
    getIngredientVendorSelectionKey,
    loadOtherSiteVendorPrices,
    menuRows,
    recipeById,
    showIngredientVendorColumn,
    useOtherSiteVendorByIngredientKey,
  ])

  const toggleMenuRowDetails = (id: string) => {
    setExpandedMenuRows((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }/* Fungsi untuk menambahkan atau menghapus id baris menu dari daftar expandedMenuRows, yang menentukan apakah detail resep untuk baris tersebut ditampilkan atau disembunyikan. */

  const productionStats = useMemo(
    () => ({
      approved: scopedMenuProductions.filter(
        (item) => item.approvalStatus === 'approved',
      ).length,
      pending: scopedMenuProductions.filter((item) => item.approvalStatus === 'pending')
        .length,
      rejected: scopedMenuProductions.filter(
        (item) => item.approvalStatus === 'rejected',
      ).length,
      total: scopedMenuProductions.length,
    }),
    [scopedMenuProductions],
  )/* Menghitung statistik produksi menu berdasarkan data menuProductions, termasuk jumlah yang disetujui, menunggu persetujuan, ditolak, dan total. Hasilnya digunakan untuk menampilkan informasi ringkasan di bagian atas halaman. Digunakan useMemo untuk menghindari perhitungan ulang yang tidak perlu saat render. */  

  const findRecipeByExactQuery = (query: string) => {
    const normalized = normalizeText(query)
    if (!normalized) return undefined
    return availableRecipes.find((recipe) => {
      const name = normalizeText(recipe.name)
      const recipeCode = normalizeText(recipe.recipeCode)
      const versionedName = normalizeText(formatVersionedRecipeName(recipe))
      return (
        name === normalized ||
        recipeCode === normalized ||
        versionedName === normalized
      )
    })
  }/* Fungsi untuk mencari resep yang cocok dengan query pencarian secara tepat, baik berdasarkan nama resep maupun kode resep. Query dan data resep dinormalisasi untuk memastikan pencarian tidak sensitif terhadap spasi atau huruf kapital. Digunakan untuk menentukan apakah input pengguna cocok dengan salah satu resep yang tersedia saat mereka mengetik di kolom menu. */

  const getRecipeSuggestions = (query: string) => {
    const normalized = normalizeText(query)
    const filtered = !normalized
      ? availableRecipes
      : availableRecipes.filter((recipe) => {
          const searchable = [
            recipe.recipeCode,
            recipe.name,
            formatVersionedRecipeName(recipe),
            recipe.category,
            getRecipeSiteText(recipe),
          ]
            .filter(Boolean)
            .join(' ')
          return normalizeText(searchable).includes(normalized)
        })
    return filtered.slice(0, 20)
  }/* Fungsi untuk mendapatkan daftar resep yang cocok dengan query pencarian secara parsial berdasarkan kode, nama, kategori, dan site. */

  const positionRecipeDropdown = (input: HTMLElement) => {
    const bounds = input.getBoundingClientRect()
    const dropdownWidth = Math.min(420, window.innerWidth - 32)
    const dropdownHeight = Math.min(360, window.innerHeight - 32)
    const gap = 4
    const canOpenBelow = bounds.bottom + gap + dropdownHeight <= window.innerHeight
    const top = canOpenBelow
      ? bounds.bottom + gap
      : Math.max(16, bounds.top - dropdownHeight - gap)
    const left = Math.min(
      Math.max(16, bounds.left),
      Math.max(16, window.innerWidth - dropdownWidth - 16),
    )

    setRecipeDropdownPosition({ left, top })
  }

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

  const validateProductionActors = () => {
    if (!requireProductionActors) return true
    if (!productionUnitManagerId) {
      setInputError('Select a unit manager first.')
      setInputMessage('')
      return false
    }
    if (!productionChefId) {
      setInputError('Select the chef being assisted first.')
      setInputMessage('')
      return false
    }
    return true
  }

  const handleAddMenuRow = () => {
    if (requireProductionSite && !productionSite) {
      setInputError(emptySiteMessage)
      setInputMessage('')
      return
    }

    if (!productionDate) {
      setInputError('Select a production date first.')
      setInputMessage('')
      return
    }

    if (!productionClientId) {
      setInputError('Select a client first.')
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
    if (requireProductionSite && !productionSite) {
      setInputError(emptySiteMessage)
      setInputMessage('')
      return
    }

    if (!validateProductionActors()) return

    if (!productionDate) {
      setInputError('Select a production date first.')
      setInputMessage('')
      return
    }

    const selectedClient = productionClients.find(
      (client) => client.id === productionClientId,
    )
    if (!selectedClient) {
      setInputError('Select a valid client first.')
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
      site?: string
      clientId?: string
      clientName?: string
      chefId?: string
      unitManagerId?: string
      portion: number
      cost: number
      ingredientVendors?: MenuProductionIngredientVendorInput[]
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

      for (const [ingredientIndex, ingredient] of recipe.ingredients.entries()) {
        const ingredientSelectionKey = getIngredientVendorSelectionKey(
          row.id,
          ingredientIndex,
          ingredient.productCode,
        )
        const productKey = getVendorPricesProductKey(ingredient.productCode)
        const useOtherSiteVendor =
          useOtherSiteVendorByIngredientKey[ingredientSelectionKey] ?? false
        const vendorOptions = useOtherSiteVendor
          ? otherSiteVendorPricesByProductKey[productKey] ?? []
          : vendorPricesByProductKey[productKey] ?? []
        const selectedVendorKey = useOtherSiteVendor
          ? getSelectedOtherSiteVendorPriceKey(
              ingredientSelectionKey,
              vendorOptions,
            )
          : getSelectedVendorPriceKey(ingredientSelectionKey, vendorOptions)
        const selectedVendor = vendorOptions.find(
          (option) => option.key === selectedVendorKey,
        )
        const price =
          ingredient.ingredientType === 'NMP'
            ? getNmpUnitPrice(ingredient, ingredientSelectionKey)
            : getIngredientUnitPrice(ingredient, selectedVendor)
        if (price === undefined) {
          setInputError(
            `Price is required for ingredient ${ingredient.name || ingredient.productCode || ingredientIndex + 1}.`,
          )
          setInputMessage('')
          return
        }
      }
      const ingredientVendors: MenuProductionIngredientVendorInput[] =
        showIngredientVendorColumn
          ? recipe.ingredients
              .map<MenuProductionIngredientVendorInput | null>(
                (ingredient, ingredientIndex) => {
                  const vendorSelectionKey = getIngredientVendorSelectionKey(
                    row.id,
                    ingredientIndex,
                    ingredient.productCode,
                  )
                  if (ingredient.ingredientType === 'NMP') {
                    const nmpPrice = getNmpUnitPrice(
                      ingredient,
                      vendorSelectionKey,
                    )
                    return {
                      ingredientIndex,
                      productCode: ingredient.productCode,
                      name: ingredient.name,
                      unitOfMeasures: ingredient.unitOfMeasures,
                      vendor: 'CUSTOM',
                      price: nmpPrice,
                    }
                  }
                  const productKey = getVendorPricesProductKey(
                    ingredient.productCode,
                  )
                  const useOtherSiteVendor =
                    useOtherSiteVendorByIngredientKey[vendorSelectionKey] ??
                    false
                  const vendorOptions = useOtherSiteVendor
                    ? otherSiteVendorPricesByProductKey[productKey] ?? []
                    : vendorPricesByProductKey[productKey] ?? []
                  const selectedVendorKey = useOtherSiteVendor
                    ? getSelectedOtherSiteVendorPriceKey(
                        vendorSelectionKey,
                        vendorOptions,
                      )
                    : getSelectedVendorPriceKey(
                        vendorSelectionKey,
                        vendorOptions,
                      )
                  const selectedVendor = vendorOptions.find(
                    (option) => option.key === selectedVendorKey,
                  )
                  if (!selectedVendor) return null

                  return {
                    ingredientIndex,
                    productCode: ingredient.productCode,
                    name: ingredient.name,
                    unitOfMeasures: ingredient.unitOfMeasures,
                    vendor: selectedVendor.vendor,
                    site: selectedVendor.site,
                    currency: selectedVendor.currency,
                    minimumQuantity: selectedVendor.minimumQuantity,
                    price: getVendorUnitPrice(selectedVendor),
                  }
                },
              )
              .filter(
                (item): item is MenuProductionIngredientVendorInput =>
                  item !== null,
              )
          : []

      payload.push({
        recipeId: recipe.id,
        menuName: recipe.name,
        category: recipe.category,
        ...(requireProductionSite ? { site: productionSite } : {}),
        clientId: selectedClient.clientId,
        clientName: selectedClient.name,
        ...(requireProductionActors
          ? {
              chefId: productionChefId,
              unitManagerId: productionUnitManagerId,
            }
          : {}),
        portion: portionValue,
        cost: 0,
        ...(ingredientVendors.length > 0 ? { ingredientVendors } : {}),
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
  }

  const handleBackfillIngredientCosts = async () => {
    if (!accessToken || costSyncLoading) return

    setCostSyncLoading(true)
    setCostSyncMessage('')
    setCostSyncError('')
    try {
      const result = await apiFetch<{
        scannedRecipes: number
        updatedRecipes: number
        updatedIngredients: number
        skippedNoRawMaterial: number
        skippedMissingPrice: number
      }>(
        '/recipes/ingredient-costs/backfill',
        { method: 'PATCH' },
        accessToken,
      )
      const nextRecipes = await fetchRecipes(
        requireProductionSite && productionSite
          ? { site: productionSite }
          : undefined,
      )
      if (requireProductionSite && productionSite) {
        setSiteRecipes(nextRecipes)
        setLoadedProductionSite(productionSite)
      }
      setCostSyncMessage(
        `Synced ${result.updatedIngredients} ingredient prices across ${result.updatedRecipes} recipes.`,
      )
    } catch (error) {
      setCostSyncError(
        error instanceof Error
          ? error.message
          : 'Failed to sync ingredient prices.',
      )
    } finally {
      setCostSyncLoading(false)
    }
  }

  const inputTotalPages = Math.max(1, Math.ceil(menuRows.length / INPUT_ROWS_PER_PAGE))
  const paginatedMenuRows = menuRows.slice(
    (inputPage - 1) * INPUT_ROWS_PER_PAGE,
    inputPage * INPUT_ROWS_PER_PAGE,
  )/* Menghitung total halaman untuk paginasi berdasarkan jumlah baris menu dan jumlah baris per halaman. Kemudian, menghitung daftar baris menu yang akan ditampilkan pada halaman saat ini dengan melakukan slicing pada menuRows. Digunakan untuk menampilkan hanya sebagian baris menu sesuai dengan halaman yang dipilih oleh pengguna. */
  const inputTableColumnCount = showEstimatedCostColumns ? 9 : 7

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          {embedded ? (
            <h2 className="text-lg font-semibold">{title}</h2>
          ) : (
            <h1 className="text-2xl font-semibold">{title}</h1>
          )}
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
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
          <div className="flex flex-wrap items-end gap-3">
            {allowIngredientCostSync ? (
              <button
                type="button"
                onClick={handleBackfillIngredientCosts}
                disabled={!accessToken || costSyncLoading || siteDataLoading}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <i className="bi bi-arrow-repeat text-base" aria-hidden="true" />
                <span>
                  {costSyncLoading ? 'Syncing prices...' : 'Sync prices'}
                </span>
              </button>
            ) : null}
            {requireProductionSite ? (
              <div>
                <label className="text-xs font-medium text-muted">
                  Production site
                </label>
                <select
                  value={productionSite}
                  onChange={(event) => setProductionSite(event.target.value)}
                  className="mt-2 w-full min-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                >
                  <option value="">Select site</option>
                  {sortedProductionSiteOptions.map((site) => (
                    <option key={site.code} value={site.code}>
                      {site.name ? `${site.name} (${site.code})` : site.code}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {requireProductionActors ? (
              <>
                <div>
                  <label className="text-xs font-medium text-muted">
                    Unit Manager
                  </label>
                  <select
                    value={productionUnitManagerId}
                    onChange={(event) =>
                      setProductionUnitManagerId(event.target.value)
                    }
                    disabled={!siteDataReady || siteDataLoading}
                    className="mt-2 w-full min-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select unit manager</option>
                    {unitManagerOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted">
                    Assisted chef
                  </label>
                  <select
                    value={productionChefId}
                    onChange={(event) => setProductionChefId(event.target.value)}
                    disabled={!siteDataReady || siteDataLoading}
                    className="mt-2 w-full min-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select chef</option>
                    {chefOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
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
            <div>
              <label className="text-xs font-medium text-muted">
                Client name
              </label>
              <select
                value={productionClientId}
                onChange={(event) => setProductionClientId(event.target.value)}
                disabled={
                  !clientSiteCode || productionClientLoading || productionClients.length === 0
                }
                className="mt-2 w-full min-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {productionClientLoading
                    ? 'Loading clients...'
                    : productionClients.length === 0
                      ? 'No client available'
                      : 'Select client'}
                </option>
                {productionClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name} ({client.clientId})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {requireProductionSite ? (
          <div className="mt-4 rounded-md border border-border bg-background px-4 py-3 text-xs text-muted">
            {!productionSite
              ? 'Select a production site to load site recipes and available users.'
              : siteDataLoading
                ? 'Loading site recipes and users...'
                : siteDataError
                  ? siteDataError
                  : `Loaded ${availableRecipes.length} approved recipes, ${unitManagerOptions.length} unit managers, and ${chefOptions.length} chefs for ${productionSite}.`}
          </div>
        ) : null}

        {costSyncMessage ? (
          <p className="mt-3 text-xs font-medium text-primary">
            {costSyncMessage}
          </p>
        ) : null}
        {costSyncError ? (
          <p className="mt-3 text-xs font-medium text-danger">
            {costSyncError}
          </p>
        ) : null}

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
                {showEstimatedCostColumns ? (
                  <>
                    <th className="px-4 py-3 font-semibold">
                      Estimated Total Cost
                    </th>
                    <th className="px-4 py-3 font-semibold">Cost/Pax</th>
                  </>
                ) : null}
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
                const estimatedCostSummary = ingredients.reduce(
                  (summary, ingredient, ingredientIndex) => {
                    const ingredientQty = Number(ingredient.qty)
                    if (!Number.isFinite(ingredientQty)) return summary

                    const scaledQty =
                      portionForPreview === null
                        ? ingredientQty
                        : (ingredientQty * portionForPreview) / basePax
                    const productKey = getVendorPricesProductKey(
                      ingredient.productCode,
                    )
                    const vendorSelectionKey = getIngredientVendorSelectionKey(
                      row.id,
                      ingredientIndex,
                      ingredient.productCode,
                    )
                    const useOtherSiteVendor =
                      useOtherSiteVendorByIngredientKey[vendorSelectionKey] ??
                      false
                    const siteVendorOptions =
                      vendorPricesByProductKey[productKey] ?? []
                    const hasSiteVendorResult =
                      Object.prototype.hasOwnProperty.call(
                        vendorPricesByProductKey,
                        productKey,
                      )
                    const vendorLoading =
                      vendorPriceLoadingByProductKey[productKey] ?? false
                    const vendorError =
                      vendorPriceErrorByProductKey[productKey] ?? ''
                    const vendorDataPending =
                      showIngredientVendorColumn &&
                      Boolean(ingredient.productCode?.trim()) &&
                      (vendorLoading ||
                        (!hasSiteVendorResult && !vendorError))
                    const otherSiteVendorOptions =
                      otherSiteVendorPricesByProductKey[productKey] ?? []
                    const vendorOptions = useOtherSiteVendor
                      ? otherSiteVendorOptions
                      : siteVendorOptions
                    const selectedVendorKey = useOtherSiteVendor
                      ? getSelectedOtherSiteVendorPriceKey(
                          vendorSelectionKey,
                          vendorOptions,
                        )
                      : getSelectedVendorPriceKey(
                          vendorSelectionKey,
                          vendorOptions,
                        )
                    const selectedVendorPrice = vendorOptions.find(
                      (option) => option.key === selectedVendorKey,
                    )
                    const unitPrice =
                      ingredient.ingredientType === 'NMP'
                        ? getNmpUnitPrice(ingredient, vendorSelectionKey)
                        : getIngredientUnitPrice(
                            ingredient,
                            selectedVendorPrice,
                          )
                    if (unitPrice === undefined || vendorDataPending) {
                      return {
                        ...summary,
                        pending: summary.pending || vendorDataPending,
                      }
                    }

                    return {
                      total: summary.total + scaledQty * unitPrice,
                      hasCost: true,
                      pending: summary.pending,
                    }
                  },
                  { total: 0, hasCost: false, pending: false },
                )
                const estimatedTotalCost = estimatedCostSummary.hasCost
                  ? estimatedCostSummary.total
                  : undefined
                const estimatedCostPerPax =
                  estimatedTotalCost !== undefined
                    ? portionForPreview !== null && portionForPreview > 0
                      ? estimatedTotalCost / portionForPreview
                      : estimatedTotalCost / basePax
                    : undefined
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
                          value={row.recipeQuery}
                          onChange={(event) =>
                            updateRowMenuQuery(row.id, event.target.value)
                          }
                          onFocus={(event) => {
                            setActiveRecipeDropdownId(row.id)
                            positionRecipeDropdown(event.currentTarget)
                          }}
                          onBlur={() => {
                            window.setTimeout(() => {
                              setActiveRecipeDropdownId((current) =>
                                current === row.id ? null : current,
                              )
                              setRecipeDropdownPosition(null)
                            }, 150)
                          }}
                          placeholder={
                            availableRecipes.length === 0
                              ? 'No approved menu available'
                              : 'Search menu'
                          }
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        />
                        {activeRecipeDropdownId === row.id &&
                        recipeSuggestions.length > 0 ? (
                          <div
                            className="fixed z-[100] w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-white shadow-xl"
                            style={
                              recipeDropdownPosition
                                ? {
                                    left: recipeDropdownPosition.left,
                                    top: recipeDropdownPosition.top,
                                  }
                                : undefined
                            }
                          >
                            <div className="max-h-[22.5rem] overflow-y-auto py-1">
                              {recipeSuggestions.map((recipe) => (
                                <button
                                  key={recipe.id}
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    updateRowMenuQuery(
                                      row.id,
                                      formatVersionedRecipeName(recipe),
                                    )
                                    setActiveRecipeDropdownId(null)
                                    setRecipeDropdownPosition(null)
                                  }}
                                  className="block w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-primary-soft"
                                >
                                  <span className="block truncate text-sm font-semibold text-foreground">
                                    {formatVersionedRecipeName(recipe)}
                                  </span>
                                  <span className="mt-1 block text-xs text-muted">
                                    {recipe.category || '-'} | {getRecipeSiteText(recipe)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
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
                      {showEstimatedCostColumns ? (
                        <>
                          <td className="px-4 py-3 font-medium">
                            {estimatedCostSummary.pending
                              ? 'Loading...'
                              : formatPrice(estimatedTotalCost)}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {estimatedCostSummary.pending
                              ? 'Loading...'
                              : formatPrice(estimatedCostPerPax)}
                          </td>
                        </>
                      ) : null}
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
                        <td colSpan={inputTableColumnCount} className="px-4 py-4">
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
                                            Type
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
                                          {showIngredientVendorColumn ? (
                                            <th className="px-4 py-3 font-semibold">
                                              Vendor
                                            </th>
                                          ) : null}
                                          {showIngredientCostColumns ? (
                                            <>
                                              <th className="px-4 py-3 font-semibold">
                                                Price
                                              </th>
                                              <th className="px-4 py-3 font-semibold">
                                                Ingredient Cost
                                              </th>
                                            </>
                                          ) : null}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {ingredients.map((ingredient, idx) => {
                                          const productKey =
                                            getVendorPricesProductKey(
                                              ingredient.productCode,
                                            )
                                          const siteVendorOptions =
                                            vendorPricesByProductKey[
                                              productKey
                                            ] ?? []
                                          const vendorLoading =
                                            vendorPriceLoadingByProductKey[
                                              productKey
                                            ] ?? false
                                          const vendorError =
                                            vendorPriceErrorByProductKey[
                                              productKey
                                            ] ?? ''
                                          const vendorSelectionKey =
                                            getIngredientVendorSelectionKey(
                                              row.id,
                                              idx,
                                              ingredient.productCode,
                                            )
                                          const useOtherSiteVendor =
                                            useOtherSiteVendorByIngredientKey[
                                              vendorSelectionKey
                                            ] ?? false
                                          const otherSiteVendorOptions =
                                            otherSiteVendorPricesByProductKey[
                                              productKey
                                            ] ?? []
                                          const otherSiteVendorLoading =
                                            otherSiteVendorPriceLoadingByProductKey[
                                              productKey
                                            ] ?? false
                                          const otherSiteVendorError =
                                            otherSiteVendorPriceErrorByProductKey[
                                              productKey
                                            ] ?? ''
                                          const vendorOptions =
                                            useOtherSiteVendor
                                              ? otherSiteVendorOptions
                                              : siteVendorOptions
                                          const selectedVendorKey =
                                            useOtherSiteVendor
                                              ? getSelectedOtherSiteVendorPriceKey(
                                                  vendorSelectionKey,
                                                  vendorOptions,
                                                )
                                              : getSelectedVendorPriceKey(
                                                  vendorSelectionKey,
                                                  vendorOptions,
                                                )
                                          const selectedVendorPrice =
                                            vendorOptions.find(
                                              (option) =>
                                                option.key ===
                                                selectedVendorKey,
                                            )
                                          const isNmp = ingredient.ingredientType === 'NMP'
                                          const nmpPrice = isNmp
                                            ? getNmpUnitPrice(
                                                ingredient,
                                                vendorSelectionKey,
                                              )
                                            : undefined
                                          const scaledQty =
                                            portionForPreview === null
                                              ? ingredient.qty
                                              : (ingredient.qty * portionForPreview) /
                                                basePax
                                          const unitPrice = isNmp
                                            ? nmpPrice
                                            : getIngredientUnitPrice(
                                                ingredient,
                                                selectedVendorPrice,
                                              )
                                          const totalCost =
                                            unitPrice === undefined
                                              ? undefined
                                              : scaledQty * unitPrice
                                          return (
                                            <tr
                                              key={`${ingredient.productCode}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.ingredientType || '-'}
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
                                              {showIngredientVendorColumn ? (
                                                <td className="min-w-[21rem] px-4 py-3">
                                                  {isNmp ? (
                                                    <input
                                                      type="text"
                                                      value="CUSTOM"
                                                      readOnly
                                                      aria-readonly="true"
                                                      className="w-[21rem] rounded-xl border border-border bg-slate-200 px-3 py-2 text-sm text-muted shadow-sm outline-none"
                                                    />
                                                  ) : (
                                                  <select
                                                    value={selectedVendorKey}
                                                    onChange={(event) => {
                                                      const nextValue =
                                                        event.target.value
                                                      if (
                                                        nextValue ===
                                                        USE_OTHER_SITE_VENDOR_OPTION
                                                      ) {
                                                        setUseOtherSiteVendorByIngredientKey(
                                                          (prev) => ({
                                                            ...prev,
                                                            [vendorSelectionKey]:
                                                              true,
                                                          }),
                                                        )
                                                        setSelectedVendorPriceByIngredientKey(
                                                          (prev) => ({
                                                            ...prev,
                                                            [vendorSelectionKey]:
                                                              '',
                                                          }),
                                                        )
                                                        loadOtherSiteVendorPrices(
                                                          ingredient.productCode,
                                                        ).catch(() => null)
                                                        return
                                                      }
                                                      setSelectedVendorPriceByIngredientKey(
                                                        (prev) => ({
                                                          ...prev,
                                                          [vendorSelectionKey]:
                                                            nextValue,
                                                        }),
                                                      )
                                                    }}
                                                    disabled={
                                                      vendorLoading ||
                                                      otherSiteVendorLoading
                                                    }
                                                    className={`w-[21rem] rounded-xl border px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60 ${
                                                      vendorOptions.length > 1
                                                        ? 'border-amber-400 bg-amber-100'
                                                        : 'border-border bg-white'
                                                    }`}
                                                  >
                                                    {vendorLoading ? (
                                                      <option value="">
                                                        Loading vendors...
                                                      </option>
                                                    ) : siteVendorOptions.length ===
                                                        0 &&
                                                      !useOtherSiteVendor ? (
                                                      <>
                                                        <option value="">
                                                          {vendorError ||
                                                            'No vendor for this site'}
                                                        </option>
                                                        <option
                                                          value={
                                                            USE_OTHER_SITE_VENDOR_OPTION
                                                          }
                                                        >
                                                          Use vendor from other site
                                                        </option>
                                                      </>
                                                    ) : otherSiteVendorLoading ? (
                                                      <option value="">
                                                        Loading vendors...
                                                      </option>
                                                    ) : useOtherSiteVendor &&
                                                      vendorOptions.length ===
                                                        0 ? (
                                                      <option value="">
                                                        {otherSiteVendorError ||
                                                          'No vendor from other site'}
                                                      </option>
                                                    ) : useOtherSiteVendor ? (
                                                      <option value="">
                                                        Select vendor
                                                      </option>
                                                    ) : vendorOptions.length ===
                                                      0 ? (
                                                      <option value="">
                                                        {vendorError ||
                                                          'No vendor'}
                                                      </option>
                                                    ) : null}
                                                    {vendorOptions.map(
                                                      (option) => (
                                                        <option
                                                          key={option.key}
                                                          value={option.key}
                                                        >
                                                          {formatVendorPriceLabel(
                                                            option,
                                                          )}
                                                        </option>
                                                      ),
                                                    )}
                                                  </select>
                                                  )}
                                                </td>
                                              ) : null}
                                              {showIngredientCostColumns ? (
                                                <>
                                                  <td className="px-4 py-3 font-medium">
                                                    {isNmp ? (
                                                      <input
                                                        type="number"
                                                        min={0}
                                                        step="any"
                                                        value={
                                                          customPriceByIngredientKey[
                                                            vendorSelectionKey
                                                          ] ??
                                                          ''
                                                        }
                                                        onChange={(event) =>
                                                          setCustomPriceByIngredientKey(
                                                            (prev) => ({
                                                              ...prev,
                                                              [vendorSelectionKey]:
                                                                event.target.value,
                                                            }),
                                                          )
                                                        }
                                                        onWheel={(event) =>
                                                          event.currentTarget.blur()
                                                        }
                                                        placeholder="Price"
                                                        className="w-36 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                                      />
                                                    ) : (
                                                      formatPrice(unitPrice)
                                                    )}
                                                  </td>
                                                  <td className="px-4 py-3 font-medium">
                                                    {formatPrice(totalCost)}
                                                  </td>
                                                </>
                                              ) : null}
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                      {showIngredientCostColumns ? (
                                        <tfoot className="bg-background">
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={
                                                showIngredientVendorColumn
                                                  ? 7
                                                  : 6
                                              }
                                              className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-foreground"
                                            >
                                              Estimated Total Cost
                                            </td>
                                            <td className="px-4 py-3 font-semibold">
                                              {formatPrice(estimatedTotalCost)}
                                            </td>
                                          </tr>
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={
                                                showIngredientVendorColumn
                                                  ? 7
                                                  : 6
                                              }
                                              className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-foreground"
                                            >
                                              Estimated Cost/Pax
                                            </td>
                                            <td className="px-4 py-3 font-semibold">
                                              {formatPrice(estimatedCostPerPax)}
                                            </td>
                                          </tr>
                                        </tfoot>
                                      ) : null}
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
                <td colSpan={inputTableColumnCount} className="px-4 py-3">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleAddMenuRow}
                      className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover"
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
          <ActionButton
            action="submit"
            onClick={handleSubmitToTimeline}
            size="sm"
            aria-label={submitLabel}
            title={submitLabel}
          />
        </div>
      </div>
    </div>
  )
}

export default ChefMenuCycle
