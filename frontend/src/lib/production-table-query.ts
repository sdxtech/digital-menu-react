type ProductionTableFilters = {
  productionDateFrom: string
  productionDateTo: string
  createdDateFrom?: string
  createdDateTo?: string
  clientName: string
  dateSort: string
}

export function usesProductionTableQuery(pathname: string) {
  return /^\/(unit-manager|corporate-chef)\/?$/.test(pathname) ||
    /\/(menu-production-drafts|menu-production-records|menu-production-history|menu-production-progress|menu-productions)\/?$/.test(pathname)
}

export function applyProductionTableFilters(params: URLSearchParams, filters: ProductionTableFilters) {
  if (filters.productionDateFrom) params.set('startDate', filters.productionDateFrom)
  if (filters.productionDateTo) params.set('endDate', filters.productionDateTo)
  if (filters.clientName.trim()) params.set('clientName', filters.clientName.trim())
  params.set('dateSort', filters.dateSort)
  if (filters.createdDateFrom) params.set('createdFrom', new Date(`${filters.createdDateFrom}T00:00:00`).toISOString())
  if (filters.createdDateTo) {
    const end = new Date(`${filters.createdDateTo}T00:00:00`)
    end.setDate(end.getDate() + 1)
    params.set('createdBefore', end.toISOString())
  }
}
