import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearRowIngredientSelections,
  updateMenuRecipeSelection,
} from '../src/lib/menu-production-recipe-selection.ts'

const draftRow = {
  id: 'row-1', group: 'Lunch', portion: 95,
  recipeId: 'RCP0660', pricingRecipeId: 'RCP0660', recipeQuery: 'Nasi Putih',
}

test('replacing a draft recipe invalidates prices while retaining row, group, and portions', () => {
  const result = updateMenuRecipeSelection(draftRow, 'RCP0369', 'Nasi Daun Jeruk (V1)')
  assert.equal(result.resetIngredientSelections, true)
  assert.deepEqual(result.row, {
    ...draftRow, recipeId: 'RCP0369', pricingRecipeId: 'RCP0369',
    recipeQuery: 'Nasi Daun Jeruk (V1)',
  })
})

test('typing before selection still invalidates the original recipe prices', () => {
  const typing = updateMenuRecipeSelection(draftRow, '', 'Nasi Daun')
  assert.equal(typing.resetIngredientSelections, false)
  const selected = updateMenuRecipeSelection(typing.row, 'RCP0369', 'Nasi Daun Jeruk (V1)')
  assert.equal(selected.resetIngredientSelections, true)
})

test('reselecting the original recipe after an incomplete search keeps saved prices', () => {
  const typing = updateMenuRecipeSelection(draftRow, '', '')
  const selected = updateMenuRecipeSelection(typing.row, 'RCP0660', 'Nasi Putih')
  assert.equal(selected.resetIngredientSelections, false)
  assert.deepEqual(selected.row, draftRow)
})

test('replacement clears even shared ingredients, NMP prices and vendor selections only in that row', () => {
  const prices = { 'row-1::0::it01090_n': '320000', 'row-1::1::nmp': '100', 'row-10::0::it01090_n': '310000' }
  const vendors = { 'row-1::0::it01090_n': 'old-vendor', 'row-10::0::it01090_n': 'saved-vendor' }
  assert.deepEqual(clearRowIngredientSelections(prices, draftRow.id), { 'row-10::0::it01090_n': '310000' })
  assert.deepEqual(clearRowIngredientSelections(vendors, draftRow.id), { 'row-10::0::it01090_n': 'saved-vendor' })
  assert.equal(prices['row-1::0::it01090_n'], '320000')
})

test('switching back after a replacement starts fresh instead of reviving previous overrides', () => {
  const changed = updateMenuRecipeSelection(draftRow, 'RCP0369', 'Nasi Daun Jeruk (V1)')
  const reverted = updateMenuRecipeSelection(changed.row, 'RCP0660', 'Nasi Putih')
  assert.equal(reverted.resetIngredientSelections, true)
})

test('fresh Add Menu and replacement both reset ingredient selections on a new recipe', () => {
  const fresh = { ...draftRow, recipeId: '', pricingRecipeId: '', recipeQuery: '' }
  assert.equal(updateMenuRecipeSelection(fresh, 'RCP0369', 'Nasi Daun Jeruk (V1)').resetIngredientSelections, true)
  assert.equal(updateMenuRecipeSelection(draftRow, 'RCP0369', 'Nasi Daun Jeruk (V1)').resetIngredientSelections, true)
})
