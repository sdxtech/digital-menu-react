import assert from 'node:assert/strict'
import test from 'node:test'
import {
  forecastDate, forecastIngredientAmounts, forecastKey, forecastRecipeCostPerPax, forecastRowCost,
  parseForecastDrafts, shiftForecastDate, type ForecastRow,
} from '../src/lib/production-forecast.ts'
import { summarizePortionsByGroup } from '../src/lib/menu-production-quantity.ts'

const row: ForecastRow = {
  id: 'row-1', group: 'Lunch', recipeId: 'recipe-1', recipeCode: 'R001',
  menu: 'Rice (V1)', category: 'Main', portion: 100, costPerPax: 1500,
}

test('calendar navigation crosses months and years without changing the local date', () => {
  assert.equal(forecastDate(new Date(2026, 9, 20, 1)), '2026-10-20')
  assert.equal(shiftForecastDate('2026-12-29', 7), '2027-01-05')
  assert.equal(shiftForecastDate('2026-03-01', -7), '2026-02-22')
  assert.equal(shiftForecastDate('2028-02-28', 1), '2028-02-29')
})

test('cost scales ingredient prices by base portions and supports saved food cost', () => {
  const cost = forecastRecipeCostPerPax({
    portionSize: 10,
    ingredients: [{ qty: 2, priceUom: 5000, foodCost: 1 }, { qty: 1, foodCost: 5000 }],
  })
  assert.equal(cost, 1500)
  assert.equal(forecastRowCost({ ...row, costPerPax: cost }), 150000)
  assert.equal(forecastRowCost({ ...row, portion: 200 }), 300000)
})

test('missing or invalid ingredient costs remain unknown instead of understating totals', () => {
  for (const recipe of [
    { portionSize: 0, ingredients: [{ qty: 1, priceUom: 10 }] },
    { portionSize: 1, ingredients: [] },
    { portionSize: 1, ingredients: [{ qty: 1 }] },
    { portionSize: 1, ingredients: [{ qty: 1, priceUom: -1 }] },
    { portionSize: 1, ingredients: [{ qty: NaN, priceUom: 1 }] },
  ]) assert.equal(forecastRecipeCostPerPax(recipe), null)
  assert.equal(forecastRowCost({ ...row, portion: '' }), null)
  assert.equal(forecastRowCost({ ...row, portion: -1 }), null)
  assert.equal(forecastRowCost({ ...row, costPerPax: null }), null)
  assert.equal(forecastRowCost({ ...row, costPerPax: 0 }), 0)
})

test('daily pax counts the largest portion per meal group', () => {
  const rows = [row, { ...row, portion: 80 }, { ...row, group: 'Dinner', portion: 50 }]
  const pax = summarizePortionsByGroup(rows).total
  assert.equal(pax, 150)
  const total = rows.reduce((sum, item) => sum + (forecastRowCost(item) ?? 0), 0)
  assert.equal(total / pax, 2300)
})

test('ingredient details scale quantities and costs to forecast portions', () => {
  const ingredient = { qty: 2.5, priceUom: 12000 }
  assert.deepEqual(forecastIngredientAmounts(ingredient, 10, 30), { qty: 7.5, cost: 90000 })
  assert.deepEqual(forecastIngredientAmounts(ingredient, 10, ''), { qty: 2.5, cost: 30000 })
  assert.deepEqual(forecastIngredientAmounts({ qty: 2, foodCost: 8000 }, 10, 5), { qty: 1, cost: 4000 })
  assert.deepEqual(forecastIngredientAmounts({ qty: 2 }, 10, 5), { qty: 1, cost: null })
  assert.deepEqual(forecastIngredientAmounts({ qty: 0 }, 10, 5), { qty: 0, cost: 0 })
})

test('ingredient details do not display misleading amounts for invalid portions or quantities', () => {
  for (const base of [0, -1, NaN, Infinity]) {
    assert.deepEqual(forecastIngredientAmounts({ qty: 1, priceUom: 10 }, base, 20), { qty: null, cost: null })
  }
  for (const portion of [0, -1, NaN, Infinity]) {
    assert.deepEqual(forecastIngredientAmounts({ qty: 1, priceUom: 10 }, 10, portion), { qty: null, cost: null })
  }
  assert.deepEqual(forecastIngredientAmounts({ qty: -1, priceUom: 10 }, 10, 20), { qty: null, cost: null })
  assert.deepEqual(forecastIngredientAmounts({ qty: 2, priceUom: -1 }, 10, 20), { qty: 4, cost: null })
})

test('browser drafts round trip with isolated site, client, and date keys', () => {
  const key = forecastKey('S001', 'C001', '2026-10-20')
  const drafts = { [key]: [row] }
  assert.deepEqual(parseForecastDrafts(JSON.stringify(drafts)), drafts)
  assert.deepEqual(parseForecastDrafts(null), {})
  assert.notEqual(key, forecastKey('S002', 'C001', '2026-10-20'))
  assert.notEqual(key, forecastKey('S001', 'C002', '2026-10-20'))
  assert.notEqual(key, forecastKey('S001', 'C001', '2026-10-21'))
})

test('invalid browser data is rejected before rendering', () => {
  for (const value of ['null', '[]', '{', '{"invalid": []}', JSON.stringify({
    [forecastKey('S001', 'C001', '2026-10-20')]: [{ ...row, portion: 'invalid' }],
  })]) assert.throws(() => parseForecastDrafts(value))
})
