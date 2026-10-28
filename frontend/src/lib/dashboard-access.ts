import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import { useAuth } from './auth'

export const dashboardComponents = [
  { key: 'foodCostCard', label: 'Average Food Cost (%)', group: 'Summary cards' },
  { key: 'paxCard', label: 'Total Pax Calculation', group: 'Summary cards' },
  { key: 'costCard', label: 'Total Estimated Food Cost (IDR)', group: 'Summary cards' },
  { key: 'revenueCard', label: 'Total Estimated Revenue (IDR)', group: 'Summary cards' },
  { key: 'approvalStatus', label: 'Production Approval Status', group: 'Production status' },
  { key: 'storeRequestStatus', label: 'Store Request Status', group: 'Production status' },
  { key: 'foodCostChart', label: 'Food Cost (%) chart', group: 'Charts' },
  { key: 'paxChart', label: 'Pax Calculation chart', group: 'Charts' },
  { key: 'financialChart', label: 'Estimated Food Cost & Revenue chart', group: 'Charts' },
] as const
export type DashboardComponent = typeof dashboardComponents[number]['key']
export type AccessDecision = 'inherit' | 'allow' | 'deny'
export type DashboardPolicy = {
  dashboard: AccessDecision
  components: { key: DashboardComponent; decision: AccessDecision }[]
  siteMode: 'inherit' | 'all' | 'selected'
  sites: string[]
}
export type DashboardAccess = {
  dashboard: boolean
  components: Record<DashboardComponent, boolean>
  sites: string[] | null
}
export type DashboardSettings = {
  target: { id: string; name: string; roles: string[]; assignedSites: string[]; locked: boolean }
  policy: DashboardPolicy
  effective: DashboardAccess
}
export const emptyDashboardPolicy = (): DashboardPolicy => ({
  dashboard: 'inherit', components: [], siteMode: 'inherit', sites: [],
})

export function useDashboardAccess() {
  const { accessToken, user } = useAuth()
  return useQuery({
    queryKey: ['dashboard-access', user?.id ?? user?.email],
    enabled: Boolean(accessToken),
    queryFn: ({ signal }) => apiFetch<DashboardAccess>('/dashboard/access', { signal }, accessToken ?? undefined),
  })
}
