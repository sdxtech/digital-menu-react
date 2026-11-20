const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectMenu, repairBatch } = require('./repair-mpr-planned-cost');

const target = { site: 'SOKIT', productionCode: 'MPR1029', productionDate: '2026-11-23' };
function tea() {
  const identity = { productCode: 'IT07490_N', unitOfMeasures: 'PK', name: 'Tea' };
  return { ...target, _id: 'tea', portion: 50, storeRequestStatus: 'requested',
    estimatedTotalCost: 22900, estimatedCostPerPax: 458, cost: 22900,
    recipeSnapshot: { portionSize: 25, ingredients: [{ ...identity, qty: 1, priceUom: 99999 }] },
    ingredientVendors: [{ ...identity, ingredientIndex: 0, price: 11450, ingredientCost: 137400 }] };
}

test('requires identifiable historical inputs and preserves closed and consistent records', () => {
  for (const modify of [
    menu => { delete menu.ingredientVendors[0].price; },
    menu => { menu.ingredientVendors[0].unitOfMeasures = 'CTN'; },
    menu => { menu.ingredientVendors[0].ingredientIndex = 1; },
    menu => { menu.estimatedTotalCost = 137400; },
    menu => { menu.storeRequestStatus = 'fulfilled'; },
    menu => { menu.storeRequestStatus = 'cancelled'; },
    menu => { menu.isDraft = true; },
  ]) {
    const menu = tea();
    modify(menu);
    assert.equal(inspectMenu(menu).status, 'skipped');
  }
  const menu = tea();
  menu.ingredientVendors[0].ingredientCost = menu.estimatedTotalCost;
  assert.equal(inspectMenu(menu).status, 'consistent');
});

test('previews, verifies the reviewed inputs and atomically repairs only planned costs', async () => {
  const menu = tea();
  const writes = [];
  const collection = {
    find(query) {
      assert.deepEqual(query, target);
      return { sort: () => ({ toArray: async () => [structuredClone(menu)] }) };
    },
    async updateOne(filter, { $set }) {
      assert.deepEqual(filter.ingredientVendors, menu.ingredientVendors);
      assert.equal(filter.storeRequestStatus, 'requested');
      assert.equal($set['ingredientVendors.0.ingredientCost'], 22900);
      assert.equal($set.estimatedTotalCost, 22900);
      assert.equal($set.historicalCostRepair.lines[0].before, 137400);
      assert.equal($set.historicalCostRepair.lines[0].price, 11450);
      assert.equal(Object.keys($set).some(key => key.endsWith('.price')), false);
      writes.push($set);
      menu.costCalculationVersion = $set.costCalculationVersion;
      return { modifiedCount: 1 };
    },
  };
  const log = () => {};
  const digest = await repairBatch(collection, target, undefined, log);
  assert.equal(writes.length, 0);
  await assert.rejects(repairBatch(collection, target, 'stale', log), /Preview has changed/);
  assert.equal(writes.length, 0);
  await repairBatch(collection, target, digest, log);
  await repairBatch(collection, target, digest, log);
  assert.equal(writes.length, 1);
});
