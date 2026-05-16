const mongoose = require('../backend/node_modules/mongoose');

const mongoUri =
  process.env.MONGO_URI || 'mongodb://localhost:27017/digital_menu';

const normalizeSiteKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const getUniqueKey = (item, siteNormalized) =>
  [
    item.productCodeNormalized,
    siteNormalized,
    item.vendorNormalized,
    item.currencyNormalized ?? '',
    item.unitOfMeasuresNormalized,
    item.minimumQuantity ?? '',
  ].join('|');

const isBetterRecord = (candidate, current) => {
  const candidatePrice = Number(candidate.price);
  const currentPrice = Number(current.price);
  const candidateHasPrice = Number.isFinite(candidatePrice);
  const currentHasPrice = Number.isFinite(currentPrice);

  if (candidateHasPrice && !currentHasPrice) return true;
  if (candidateHasPrice && currentHasPrice && candidatePrice > currentPrice) {
    return true;
  }

  const candidateTime = new Date(candidate.updatedAt ?? candidate.createdAt ?? 0)
    .getTime();
  const currentTime = new Date(current.updatedAt ?? current.createdAt ?? 0)
    .getTime();
  return candidateTime > currentTime;
};

const main = async () => {
  await mongoose.connect(mongoUri);
  const collection = mongoose.connection.collection('rawmaterialvendorprices');

  const cursor = collection.find({});
  const bestByKey = new Map();
  const duplicates = [];
  let scanned = 0;
  let skippedMissingSite = 0;

  for await (const item of cursor) {
    scanned += 1;
    const siteNormalized = normalizeSiteKey(item.site);
    if (!siteNormalized) {
      skippedMissingSite += 1;
      continue;
    }

    const key = getUniqueKey(item, siteNormalized);
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, { item, siteNormalized });
      continue;
    }

    if (isBetterRecord(item, current.item)) {
      duplicates.push(current.item._id);
      bestByKey.set(key, { item, siteNormalized });
    } else {
      duplicates.push(item._id);
    }
  }

  const operations = [];
  for (const { item, siteNormalized } of bestByKey.values()) {
    if (item.siteNormalized === siteNormalized) continue;
    operations.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { siteNormalized } },
      },
    });
  }

  let updated = 0;
  for (let index = 0; index < operations.length; index += 500) {
    const batch = operations.slice(index, index + 500);
    const result = await collection.bulkWrite(batch, { ordered: false });
    updated += result.modifiedCount ?? 0;
  }

  let deletedDuplicates = 0;
  for (let index = 0; index < duplicates.length; index += 500) {
    const batch = duplicates.slice(index, index + 500);
    const result = await collection.deleteMany({ _id: { $in: batch } });
    deletedDuplicates += result.deletedCount ?? 0;
  }

  console.log(
    JSON.stringify(
      {
        collection: 'rawmaterialvendorprices',
        scanned,
        updated,
        deletedDuplicates,
        skippedMissingSite,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
