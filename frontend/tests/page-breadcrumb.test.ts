import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePageBreadcrumb } from '../src/lib/page-breadcrumb.ts'

const menuManagement = {
  label: 'Menu Management',
  to: '/superadmin/menu-management?tab=recipes',
  children: [
    { label: 'Recipe Data', to: '/superadmin/menu-management?tab=recipes' },
    {
      label: 'Create New Recipe',
      to: '/superadmin/menu-management?tab=create-recipe',
      breadcrumbPaths: ['/superadmin/menu-create'],
    },
    { label: 'Recipe Drafts', to: '/superadmin/recipe-drafts' },
  ],
}

const approvalCenter = {
  label: 'Approval Center',
  to: '/unit-manager?section=recipes',
  children: [
    { label: 'Recipe Approval', to: '/unit-manager?section=recipes' },
    { label: 'Menu Production Approval', to: '/unit-manager?section=menu-productions' },
  ],
}

test('query tabs select their submenu even with other URL parameters', () => {
  const breadcrumb = resolvePageBreadcrumb([menuManagement], '/superadmin/menu-management', '?draftId=42&tab=create-recipe')
  assert.equal(breadcrumb?.current.label, 'Create New Recipe')
  assert.equal(breadcrumb?.parent.to, menuManagement.to)
})

test('parent URLs resolve the same default submenu as the page', () => {
  for (const search of ['', '?site=S001', '?tab=unknown']) {
    assert.equal(resolvePageBreadcrumb([menuManagement], '/superadmin/menu-management', search)?.current.label, 'Recipe Data')
  }
  assert.equal(resolvePageBreadcrumb([approvalCenter], '/unit-manager', '')?.current.label, 'Recipe Approval')
})

test('draft and standalone edit routes retain their menu hierarchy', () => {
  assert.equal(resolvePageBreadcrumb([menuManagement], '/superadmin/recipe-drafts/', '')?.current.label, 'Recipe Drafts')
  assert.equal(resolvePageBreadcrumb([menuManagement], '/superadmin/menu-create', '')?.current.label, 'Create New Recipe')
})

test('approval sections distinguish submenu pages on a shared route', () => {
  assert.equal(resolvePageBreadcrumb([approvalCenter], '/unit-manager', '?section=menu-productions&site=S001')?.current.label, 'Menu Production Approval')
})

test('standalone, unknown, and other role pages do not inherit an unrelated breadcrumb', () => {
  for (const pathname of ['/superadmin/users', '/superadmin/menu-management/unknown', '/unit-manager/recipe-data', '/chef/menu-create']) {
    assert.equal(resolvePageBreadcrumb([menuManagement, approvalCenter], pathname, ''), null)
  }
})
