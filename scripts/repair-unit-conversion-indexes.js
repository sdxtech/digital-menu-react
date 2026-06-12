const mongoose = require('../backend/node_modules/mongoose');

const mongoUri =
  process.env.MONGO_URI || 'mongodb://localhost:27017/digital_menu';

const desiredUniqueIndex = {
  prodUomCode: 1,
  srUomCode: 1,
};

const sameKey = (left, right) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
};

const isLegacyIndex = (index) =>
  Object.keys(index.key).some((key) =>
    ['fromUnitCode', 'toUnitCode', 'fromQuantity', 'toQuantity'].includes(key),
  );

const main = async () => {
  await mongoose.connect(mongoUri);
  const collection = mongoose.connection.collection('unitconversions');
  const indexes = await collection.indexes();

  for (const index of indexes) {
    if (index.name === '_id_') continue;
    if (sameKey(index.key, desiredUniqueIndex)) continue;
    if (!index.unique && !isLegacyIndex(index)) continue;

    console.log(`Dropping obsolete index: ${index.name}`);
    await collection.dropIndex(index.name);
  }

  console.log('Ensuring unique index: prodUomCode + srUomCode');
  await collection.createIndex(desiredUniqueIndex, {
    unique: true,
    name: 'prodUomCode_1_srUomCode_1',
  });

  console.log('Unit conversion indexes repaired.');
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
