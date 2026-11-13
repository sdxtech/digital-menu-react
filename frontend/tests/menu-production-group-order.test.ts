import assert from 'node:assert/strict'
import test from 'node:test'
import { sortMenuItemsByGroup } from '../src/lib/menu-production-quantity.ts'

test('menu lists keep interleaved groups together and sort menus within each group', () => {
  const items = [
    { group: 'PKL', menuName: 'Buah Melon' },
    { group: 'PKL', menuName: 'Ayam' },
    { group: 'HEALTHY', menuName: 'Steamed Rice' },
    { group: 'SALAD', menuName: 'Garden Mix Salad' },
    { group: 'HEALTHY', menuName: 'Mixed Fruit' },
  ]
  const original = [...items]
  assert.deepEqual(sortMenuItemsByGroup(items).map((item) => item.menuName), [
    'Mixed Fruit', 'Steamed Rice', 'Ayam', 'Buah Melon', 'Garden Mix Salad',
  ])
  assert.deepEqual(items, original)
})

test('group sorting handles whitespace, letter case, empty groups and numeric names', () => {
  const items = [
    { group: ' healthy ', menuName: 'Menu 10' },
    { group: 'HEALTHY', menuName: 'Menu 2' },
    { menuName: 'Ungrouped' },
    { group: ' ', menuName: 'Empty group' },
  ]
  assert.deepEqual(sortMenuItemsByGroup(items).map((item) => item.menuName), [
    'Empty group', 'Ungrouped', 'Menu 2', 'Menu 10',
  ])
})
