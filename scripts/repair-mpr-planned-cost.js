// Preview: node --env-file=backend/.env scripts/repair-mpr-planned-cost.js SITE MPR1029 2026-11-23
// Apply the reviewed preview: repeat the command with --apply DIGEST.
const { createHash } = require('node:crypto');
const mongoose = require('../backend/node_modules/mongoose');

const money = (amount) => Number(amount.toFixed(2));
const sixDecimals = (amount) => Number(amount.toFixed(6));
class RepairError extends Error {}

function inspectMenu(menu) {
  const skip = (reason) => ({ status: 'skipped', reason });
  if (menu.costCalculationVersion === 2) return { status: 'current' };
  if (menu.costCalculationVersion != null && menu.costCalculationVersion !== 1)
    return skip('Unrecognized cost calculation version');
  if (menu.isDraft || !['requested', 'not-requested'].includes(menu.storeRequestStatus))
    return skip('Draft, closed, or unknown store request status');

  const snapshot = menu.recipeSnapshot;
  const vendors = menu.ingredientVendors;
  if (!Number.isSafeInteger(menu.portion) || menu.portion <= 0 ||
      !Number.isFinite(snapshot?.portionSize) || snapshot.portionSize <= 0 ||
      !Array.isArray(snapshot.ingredients) || !snapshot.ingredients.length ||
      !Array.isArray(vendors) || vendors.length !== snapshot.ingredients.length)
    return skip('Incomplete historical recipe, portion, or vendor snapshot');

  const multiplier = menu.portion / snapshot.portionSize;
  const lines = [];
  const changes = {};
  let total = 0;
  let materialDifference = false;
  // The original total can include rounding of each SR quantity and cost per pax.
  let roundingBound = 0.005 + menu.portion * 0.0000005;
  for (const [index, ingredient] of snapshot.ingredients.entries()) {
    if (!ingredient || !Number.isFinite(ingredient.qty) || ingredient.qty < 0)
      return skip(`Missing historical quantity at ingredient ${index + 1}`);
    const position = vendors.findIndex((row) => row?.ingredientIndex === index);
    const saved = vendors[position];
    if (!saved || !ingredient.productCode?.trim() || !ingredient.unitOfMeasures?.trim() ||
        ['productCode', 'name', 'unitOfMeasures'].some((key) =>
          (saved[key] ?? '').trim() !== (ingredient[key] ?? '').trim()) ||
        !Number.isFinite(saved.price) || saved.price < 0 ||
        (saved.price === 0 && ingredient.ingredientType !== 'NMP') ||
        !Number.isFinite(saved.ingredientCost) || saved.ingredientCost < 0)
      return skip(`Missing or ambiguous historical price/cost for ingredient ${index + 1}`);
    const qty = sixDecimals(ingredient.qty * multiplier);
    const after = qty * saved.price;
    const bound = saved.price * 0.0000005 + 0.0000005;
    roundingBound += bound;
    total += after;
    if (Math.abs(saved.ingredientCost - after) > bound + 0.005) materialDifference = true;
    if (saved.ingredientCost !== after) {
      changes[`ingredientVendors.${position}.ingredientCost`] = after;
      lines.push({ index, code: saved.productCode, name: saved.name, vendor: saved.vendor,
        unit: saved.unitOfMeasures, qty, price: saved.price, before: saved.ingredientCost, after });
    }
  }
  if (!materialDifference) return { status: 'consistent' };
  if (!Number.isFinite(total) || !Number.isFinite(menu.estimatedTotalCost) ||
      Math.abs(total - menu.estimatedTotalCost) > roundingBound)
    return skip('Historical menu estimate does not corroborate the revised portions');
  return { status: 'repair', lines, total, changes };
}

async function run(args) {
  const [site, productionCode, productionDate, flag, approval] = args;
  if (![3, 5].includes(args.length) || !site?.trim() || !/^MPR\d+$/i.test(productionCode) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(productionDate) ||
      (args.length === 5 && (flag !== '--apply' || !/^[a-f0-9]{64}$/.test(approval))))
    throw new RepairError('Usage: SITE MPR_CODE YYYY-MM-DD [--apply PREVIEW_DIGEST]');
  if (!process.env.MONGO_URI) throw new RepairError('Configure MONGO_URI for the intended database.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  const collection = mongoose.connection.collection('menuproductions');
  await repairBatch(collection, { site, productionCode, productionDate }, approval);
}

async function repairBatch(collection, target, approval, log = console.log) {
  const menus = await collection.find(target).sort({ _id: 1 }).toArray();
  if (!menus.length) throw new RepairError('No records match this site, MPR code, and production date.');
  const repairs = [];
  for (const menu of menus) {
    const result = inspectMenu(menu);
    const { changes, ...report } = result;
    log(JSON.stringify({ id: menu._id, menu: menu.menuName, previousTotal: menu.estimatedTotalCost,
      previousCost: menu.cost, previousCostPerPax: menu.estimatedCostPerPax, ...report }));
    if (result.status !== 'repair') continue;
    // Check all inputs again on write, even for legacy records without timestamps.
    const filter = { ...target, _id: menu._id };
    for (const field of ['recipeSnapshot', 'ingredientVendors', 'portion', 'costCalculationVersion',
      'approvalStatus', 'storeRequestStatus', 'isDraft', 'cost', 'estimatedTotalCost',
      'estimatedCostPerPax', 'updatedAt']) {
      filter[field] = menu[field] === undefined ? { $exists: false } : menu[field];
    }
    repairs.push({ filter, changes, lines: result.lines, total: result.total,
      previous: { cost: menu.cost, estimatedTotalCost: menu.estimatedTotalCost,
        estimatedCostPerPax: menu.estimatedCostPerPax, costCalculationVersion: menu.costCalculationVersion } });
  }
  if (!repairs.length) {
    log('No eligible changes.');
    return;
  }
  const digest = createHash('sha256').update(JSON.stringify(repairs)).digest('hex');
  if (!approval) {
    log(`Preview: ${repairs.length} menus. Review the changes before applying digest ${digest}`);
    return digest;
  }
  if (approval !== digest) throw new RepairError('Preview has changed. Review a fresh preview.');
  for (const { filter, changes, lines, total, previous } of repairs) {
    const at = new Date();
    const result = await collection.updateOne(filter, { $set: {
      ...changes, costCalculationVersion: 2, cost: total, estimatedTotalCost: total,
      estimatedCostPerPax: sixDecimals(total / filter.portion), updatedAt: at,
      historicalCostRepair: { at, digest, lines, previous },
    } });
    if (result.modifiedCount !== 1) throw new RepairError('Concurrent change. Preview remaining records again.');
    log(`Updated ${filter._id}, planned total ${money(total)}`);
  }
}

module.exports = { inspectMenu, repairBatch };
if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    // Mongo errors can include connection details. Only show our own validation messages.
    console.error(error instanceof RepairError ? error.message : error.name);
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
