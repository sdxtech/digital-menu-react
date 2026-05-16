const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('../backend/node_modules/exceljs');
const mongoose = require('../backend/node_modules/mongoose');

const workbookPath = process.argv[2];
const mongoUri =
  process.env.MONGO_URI || 'mongodb://localhost:27017/digital_menu';

if (!workbookPath) {
  console.error('Usage: node scripts/import-pricelist-raw-materials.js <file.xlsx>');
  process.exit(1);
}

const normalizeText = (value) => String(value ?? '').trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value);
  if (!text) return undefined;

  let normalized = text.replace(/\s/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '');
  } else if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getCellText = (values, index) => {
  const value = values[index];
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && 'text' in value) {
    return normalizeText(value.text);
  }
  if (typeof value === 'object' && 'result' in value) {
    return normalizeText(value.result);
  }
  return normalizeText(value);
};

const normalizeHeader = (value) =>
  normalizeText(value).toLowerCase().replace(/\./g, '_').replace(/\$/g, '');

const headerAliases = {
  productCode: [
    'product code',
    'product_code',
    'productcode',
    'code',
    'sku',
    'kode',
    'kode produk',
  ],
  name: ['name', 'nama', 'product name', 'material name'],
  site: ['site', 'location', 'lokasi', 'cabang'],
  vendor: ['vendor', 'supplier', 'supplier name', 'vendor name', 'pemasok'],
  currency: ['currency', 'curr', 'mata uang', 'mata_uang'],
  minimumQuantity: [
    'minimal quantity',
    'minimum quantity',
    'min quantity',
    'min qty',
    'minimal qty',
    'minimum qty',
    'min_qty',
    'minimum_qty',
    'minimal_qty',
  ],
  unitOfMeasures: [
    'unit of measures',
    'unit of measure',
    'unit',
    'uom',
    'unit_of_measures',
    'satuan',
  ],
  price: ['price', 'unit price', 'unit_price', 'harga', 'cost'],
};

const buildHeaderMap = (values) => {
  const map = {};

  for (let index = 1; index < values.length; index += 1) {
    const header = normalizeHeader(values[index]);
    if (!header) continue;

    for (const [field, aliases] of Object.entries(headerAliases)) {
      if (aliases.includes(header)) {
        map[field] = index;
        break;
      }
    }
  }

  for (const required of ['productCode', 'name', 'unitOfMeasures']) {
    if (!map[required]) {
      throw new Error(
        'Header must include Product Code, Name, and Unit of Measure.',
      );
    }
  }

  return map;
};

const flush = async (rawMaterials, vendorPrices) => {
  if (rawMaterials.size) {
    await mongoose.connection.collection('rawmaterials').bulkWrite(
      Array.from(rawMaterials.values()).map((item) => ({
        updateOne: {
          filter: { productCodeNormalized: item.productCodeNormalized },
          update: {
            $set: {
              productCode: item.productCode,
              name: item.name,
              unitOfMeasures: item.unitOfMeasures,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              productCodeNormalized: item.productCodeNormalized,
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    rawMaterials.clear();
  }

  if (vendorPrices.size) {
    await mongoose.connection.collection('rawmaterialvendorprices').bulkWrite(
      Array.from(vendorPrices.values()).map((item) => ({
        updateOne: {
          filter: {
            productCodeNormalized: item.productCodeNormalized,
            siteNormalized: item.siteNormalized,
            vendorNormalized: item.vendorNormalized,
            currencyNormalized: item.currencyNormalized,
            unitOfMeasuresNormalized: item.unitOfMeasuresNormalized,
            minimumQuantity: item.minimumQuantity,
          },
          update: {
            $set: {
              productCode: item.productCode,
              name: item.name,
              unitOfMeasures: item.unitOfMeasures,
              unitOfMeasuresNormalized: item.unitOfMeasuresNormalized,
              site: item.site,
              siteNormalized: item.siteNormalized,
              vendor: item.vendor,
              vendorNormalized: item.vendorNormalized,
              currency: item.currency,
              currencyNormalized: item.currencyNormalized,
              minimumQuantity: item.minimumQuantity,
              price: item.price,
              extraFields: {},
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    vendorPrices.clear();
  }
};

(async () => {
  const absolutePath = path.resolve(workbookPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  await mongoose.connect(mongoUri);
  await mongoose.connection.collection('rawmaterialvendorprices').createIndex(
    {
      productCodeNormalized: 1,
      siteNormalized: 1,
      vendorNormalized: 1,
      currencyNormalized: 1,
      unitOfMeasuresNormalized: 1,
      minimumQuantity: 1,
    },
    { unique: true },
  );

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(
    fs.createReadStream(absolutePath),
    {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
    },
  );

  const rawMaterials = new Map();
  const vendorPrices = new Map();
  let headerMap = null;
  let processed = 0;
  let skippedVendorPrice = 0;

  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      const values = Array.isArray(row.values) ? row.values : [];
      if (!headerMap) {
        headerMap = buildHeaderMap(values);
        continue;
      }

      const productCode = getCellText(values, headerMap.productCode);
      const name = getCellText(values, headerMap.name);
      const unitOfMeasures = getCellText(values, headerMap.unitOfMeasures);
      const site = getCellText(values, headerMap.site);
      const vendor = getCellText(values, headerMap.vendor);
      const currency = getCellText(values, headerMap.currency);
      const minimumQuantity = toNumber(
        getCellText(values, headerMap.minimumQuantity),
      );
      const price = toNumber(getCellText(values, headerMap.price));

      if (!productCode || !name || !unitOfMeasures) continue;

      const productCodeNormalized = normalizeKey(productCode);
      rawMaterials.set(productCodeNormalized, {
        productCode,
        productCodeNormalized,
        name,
        unitOfMeasures,
      });

      if (!site || !vendor) {
        skippedVendorPrice += 1;
      } else {
        const item = {
          productCode,
          productCodeNormalized,
          name,
          unitOfMeasures,
          unitOfMeasuresNormalized: normalizeKey(unitOfMeasures),
          site,
          siteNormalized: normalizeKey(site),
          vendor,
          vendorNormalized: normalizeKey(vendor),
          currency: currency || undefined,
          currencyNormalized: currency ? normalizeKey(currency) : undefined,
          minimumQuantity,
          price,
        };
        const key = [
          item.productCodeNormalized,
          item.siteNormalized,
          item.vendorNormalized,
          item.currencyNormalized ?? '',
          item.unitOfMeasuresNormalized,
          item.minimumQuantity ?? '',
        ].join('|');
        const existing = vendorPrices.get(key);
        if (
          !existing ||
          (item.price !== undefined &&
            (existing.price === undefined || item.price > existing.price))
        ) {
          vendorPrices.set(key, item);
        }
      }

      processed += 1;
      if (processed % 5000 === 0) {
        await flush(rawMaterials, vendorPrices);
        console.log(`Processed ${processed} rows`);
      }
    }
    break;
  }

  await flush(rawMaterials, vendorPrices);

  const [rawMaterialCount, vendorPriceCount] = await Promise.all([
    mongoose.connection.collection('rawmaterials').countDocuments(),
    mongoose.connection.collection('rawmaterialvendorprices').countDocuments(),
  ]);

  console.log(
    JSON.stringify(
      {
        processed,
        skippedVendorPrice,
        rawMaterialCount,
        vendorPriceCount,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
