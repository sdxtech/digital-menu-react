import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDashboardPolicies, type DashboardAccessTarget } from '../src/lib/dashboard-access-save.ts'
import type { DashboardPolicy, DashboardSettings } from '../src/lib/dashboard-access.ts'

const policy: DashboardPolicy = { dashboard: 'allow', siteMode: 'selected', sites: ['A'], components: [{ key: 'paxCard', decision: 'allow' }] }
const targets: DashboardAccessTarget[] = [
  { id: 'user-1', name: 'First', type: 'user' },
  { id: 'user-2', name: 'Second', type: 'user' },
  { id: 'user-3', name: 'Third', type: 'user' },
]
const settings = (target: DashboardAccessTarget): DashboardSettings => ({
  target: { ...target, roles: ['chef'], assignedSites: ['A'], locked: false },
  policy,
  effective: { dashboard: true, sites: ['A'], components: {
    paxCard: true, foodCostCard: false, costCard: false, revenueCard: false,
    approvalStatus: false, storeRequestStatus: false, foodCostChart: false, paxChart: false, financialChart: false,
  } },
})

test('applies exactly the selected policy to all selected users in order', async () => {
  const calls: string[] = []
  const result = await applyDashboardPolicies(targets, policy, async (target, submittedPolicy) => {
    calls.push(target.id)
    assert.deepEqual(submittedPolicy, policy)
    return settings(target)
  })
  assert.deepEqual(calls, targets.map((target) => target.id))
  assert.deepEqual(result.saved.map((item) => item.target.id), calls)
  assert.deepEqual(result.failed, [])
})

test('reports partial failures per user and continues saving the remaining selections', async () => {
  const result = await applyDashboardPolicies(targets, policy, async (target) => {
    if (target.id === 'user-2') throw new Error('User no longer exists.')
    return settings(target)
  })
  assert.deepEqual(result.saved.map((item) => item.target.id), ['user-1', 'user-3'])
  assert.deepEqual(result.failed, [{ id: 'user-2', name: 'Second', message: 'User no longer exists.' }])
})

test('does not send writes for an empty selection', async () => {
  const result = await applyDashboardPolicies([], policy, () => {
    assert.fail('No target should be saved.')
  })
  assert.deepEqual(result, { saved: [], failed: [] })
})
