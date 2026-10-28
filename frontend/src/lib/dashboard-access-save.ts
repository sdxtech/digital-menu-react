import type { DashboardPolicy, DashboardSettings } from './dashboard-access'

export type DashboardAccessTarget = { id: string; name: string; type: 'role' | 'user' }

// Apply each target through the existing permission endpoint and report partial failures.
export async function applyDashboardPolicies(
  targets: DashboardAccessTarget[],
  policy: DashboardPolicy,
  save: (target: DashboardAccessTarget, policy: DashboardPolicy) => Promise<DashboardSettings>,
) {
  const saved: DashboardSettings[] = []
  const failed: { id: string; name: string; message: string }[] = []
  for (const target of targets) {
    try {
      saved.push(await save(target, policy))
    } catch (reason) {
      failed.push({ id: target.id, name: target.name, message: reason instanceof Error ? reason.message : 'Failed to save dashboard permissions.' })
    }
  }
  return { saved, failed }
}
