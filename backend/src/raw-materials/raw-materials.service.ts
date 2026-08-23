import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RawMaterial,
  RawMaterialDocument,
  RawMaterialSpecificConversion,
} from './schemas/raw-material.schema';
import {
  RawMaterialVendorPrice,
  RawMaterialVendorPriceDocument,
} from './schemas/raw-material-vendor-price.schema';
import { Recipe, RecipeDocument } from '../recipes/schemas/recipe.schema';
import { SitesService } from '../sites/sites.service';
import type {
  RawMaterialPriceUpdateInput,
  RawMaterialPriceUpdateMode,
} from './raw-material-price-update.types';

export type RawMaterialUpsertInput = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  baseUnitOfMeasures?: string;
  conversionFactor?: number;
  specificConversions?: RawMaterialSpecificConversion[];
  vendor?: string;
  currency?: string;
  minimumQuantity?: number;
  price?: number;
  priceQuantity?: number;
  extraFields?: Record<string, string>;
};

export type RawMaterialVendorPriceUpsertInput = RawMaterialUpsertInput & {
  site?: string;
  startDate?: string;
};

type ListRawMaterialsQuery = {
  page: number;
  limit: number;
  search?: string;
  site?: string;
};

type ListRawMaterialVendorPricesQuery = {
  productCode: string;
  site?: string;
  vendor?: string;
};

type BulkUpdateSpecificConversionsInput = {
  rawMaterialIds: string[];
  unitOfMeasures: string;
  baseUnitOfMeasures: string;
  conversionFactor: number;
};

export type RawMaterialLookup = {
  productCode: string;
  productCodeNormalized: string;
  unitOfMeasures: string;
  baseUnitOfMeasures?: string;
  conversionFactor?: number;
  specificConversions?: RawMaterialSpecificConversion[];
  name: string;
  price?: number;
};

@Injectable()
export class RawMaterialsService {
  constructor(
    @InjectModel(RawMaterial.name)
    private readonly rawMaterialModel: Model<RawMaterialDocument>,
    @InjectModel(RawMaterialVendorPrice.name)
    private readonly rawMaterialVendorPriceModel: Model<RawMaterialVendorPriceDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    private readonly sites: SitesService,
  ) {}

  async create(input: RawMaterialUpsertInput) {
    const normalizedCode = this.normalizeProductCode(input.productCode);
    const vendor = this.normalizeOptionalText(input.vendor);
    const currency = this.normalizeOptionalText(input.currency);
    const baseUnitOfMeasures = this.normalizeOptionalText(
      input.baseUnitOfMeasures,
    );
    const conversionFactor = this.normalizePositiveOptionalNumber(
      input.conversionFactor,
    );
    const specificConversions = input.specificConversions
      ? this.normalizeSpecificConversions(input.specificConversions)
      : undefined;
    const minimumQuantity = this.normalizeOptionalNumber(input.minimumQuantity);
    const price = this.normalizeOptionalNumber(input.price);
    const extraFields = input.extraFields;

    const updateFields: Record<string, unknown> = {
      productCode: input.productCode.trim(),
      name: input.name.trim(),
      unitOfMeasures: input.unitOfMeasures.trim(),
    };
    if (baseUnitOfMeasures !== undefined) {
      updateFields.baseUnitOfMeasures = baseUnitOfMeasures;
    }
    if (conversionFactor !== undefined) {
      updateFields.conversionFactor = conversionFactor;
    }
    if (specificConversions !== undefined) {
      updateFields.specificConversions = specificConversions;
    }
    if (vendor !== undefined) updateFields.vendor = vendor;
    if (currency !== undefined) updateFields.currency = currency;
    if (minimumQuantity !== undefined) {
      updateFields.minimumQuantity = minimumQuantity;
    }
    if (price !== undefined) updateFields.price = price;
    if (extraFields !== undefined) {
      updateFields.extraFields = extraFields;
    }

    const existing = await this.rawMaterialModel.findOneAndUpdate(
      { productCodeNormalized: normalizedCode },
      { $set: updateFields },
      { new: true },
    );

    if (existing) return existing;

    return this.rawMaterialModel.create({
      productCode: input.productCode.trim(),
      productCodeNormalized: normalizedCode,
      name: input.name.trim(),
      unitOfMeasures: input.unitOfMeasures.trim(),
      ...(baseUnitOfMeasures !== undefined ? { baseUnitOfMeasures } : {}),
      ...(conversionFactor !== undefined ? { conversionFactor } : {}),
      ...(specificConversions !== undefined ? { specificConversions } : {}),
      ...(vendor !== undefined ? { vendor } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(minimumQuantity !== undefined ? { minimumQuantity } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(extraFields !== undefined ? { extraFields } : {}),
    });
  }

  async findById(id: string) {
    const item = await this.rawMaterialModel.findById(id).lean();
    if (!item) throw new NotFoundException('Raw material not found');
    return item;
  }

  async findLookupByNormalizedCode(productCode: string) {
    const normalizedCode = this.normalizeProductCode(productCode);
    return this.rawMaterialModel
      .findOne({ productCodeNormalized: normalizedCode })
      .select({
        productCode: 1,
        productCodeNormalized: 1,
        unitOfMeasures: 1,
        baseUnitOfMeasures: 1,
        conversionFactor: 1,
        specificConversions: 1,
        name: 1,
        price: 1,
      })
      .lean<RawMaterialLookup>();
  }

  async findLookupsByNormalizedCodes(productCodes: string[]) {
    const normalizedCodes = Array.from(
      new Set(
        productCodes
          .map((productCode) => this.normalizeProductCode(productCode))
          .filter(Boolean),
      ),
    );

    if (normalizedCodes.length === 0) return [];

    return this.rawMaterialModel
      .find({ productCodeNormalized: { $in: normalizedCodes } })
      .select({
        productCode: 1,
        productCodeNormalized: 1,
        unitOfMeasures: 1,
        baseUnitOfMeasures: 1,
        conversionFactor: 1,
        specificConversions: 1,
        name: 1,
        price: 1,
      })
      .lean<RawMaterialLookup[]>();
  }

  async findAvailableNormalizedCodesForSite(
    productCodes: string[],
    site: string,
  ) {
    const normalizedCodes = Array.from(
      new Set(
        productCodes
          .map((productCode) => this.normalizeProductCode(productCode))
          .filter(Boolean),
      ),
    );
    if (normalizedCodes.length === 0) return [];

    const siteNormalizedValues = await this.resolveSiteNormalizedValues(site);
    if (siteNormalizedValues.length === 0) return [];

    return this.rawMaterialVendorPriceModel.distinct('productCodeNormalized', {
      siteNormalized: { $in: siteNormalizedValues },
      productCodeNormalized: { $in: normalizedCodes },
    });
  }

  async updateById(id: string, input: RawMaterialUpsertInput) {
    const item = await this.rawMaterialModel.findById(id);
    if (!item) throw new NotFoundException('Raw material not found');

    const productCode = input.productCode.trim();
    const name = input.name.trim();
    const unitOfMeasures = input.unitOfMeasures.trim();
    const normalizedCode = this.normalizeProductCode(productCode);
    const hasBaseUnitOfMeasures = Object.prototype.hasOwnProperty.call(
      input,
      'baseUnitOfMeasures',
    );
    const hasConversionFactor = Object.prototype.hasOwnProperty.call(
      input,
      'conversionFactor',
    );
    const hasSpecificConversions = Object.prototype.hasOwnProperty.call(
      input,
      'specificConversions',
    );
    const baseUnitOfMeasures = this.normalizeOptionalText(
      input.baseUnitOfMeasures,
    );
    const conversionFactor = this.normalizePositiveOptionalNumber(
      input.conversionFactor,
    );
    const specificConversions = hasSpecificConversions
      ? this.normalizeSpecificConversions(input.specificConversions ?? [])
      : undefined;
    const vendor = this.normalizeOptionalText(input.vendor);
    const currency = this.normalizeOptionalText(input.currency);
    const minimumQuantity = this.normalizeOptionalNumber(input.minimumQuantity);
    const price = this.normalizeOptionalNumber(input.price);

    if (item.productCodeNormalized !== normalizedCode) {
      const conflict = await this.rawMaterialModel.findOne({
        productCodeNormalized: normalizedCode,
        _id: { $ne: item._id },
      });
      if (conflict) {
        throw new BadRequestException('Product code already exists.');
      }
    }

    item.productCode = productCode;
    item.productCodeNormalized = normalizedCode;
    item.name = name;
    item.unitOfMeasures = unitOfMeasures;
    if (hasBaseUnitOfMeasures) item.baseUnitOfMeasures = baseUnitOfMeasures;
    if (hasConversionFactor) item.conversionFactor = conversionFactor;
    if (hasSpecificConversions) {
      item.specificConversions = specificConversions ?? [];
      item.baseUnitOfMeasures = undefined;
      item.conversionFactor = undefined;
    }
    if (vendor !== undefined) item.vendor = vendor;
    if (currency !== undefined) item.currency = currency;
    if (minimumQuantity !== undefined) item.minimumQuantity = minimumQuantity;
    if (price !== undefined) item.price = price;
    if (input.extraFields !== undefined) {
      item.extraFields = input.extraFields;
    }
    await item.save();

    return item.toObject();
  }

  async deleteById(id: string) {
    const existing = await this.rawMaterialModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Raw material not found');

    const productCode = existing.productCode.trim();
    const recipeUsingMaterial = await this.recipeModel
      .findOne({
        deletedAt: { $exists: false },
        'ingredients.productCode': new RegExp(
          `^${this.escapeRegExp(productCode)}$`,
          'i',
        ),
      })
      .select({ name: 1, recipeCode: 1 })
      .lean();

    if (recipeUsingMaterial) {
      const recipeLabel =
        recipeUsingMaterial.recipeCode ||
        recipeUsingMaterial.name ||
        'a recipe';
      throw new BadRequestException(
        `Raw material is used by ${recipeLabel} and cannot be deleted.`,
      );
    }

    const item = await this.rawMaterialModel.findByIdAndDelete(id).lean();
    if (!item) throw new NotFoundException('Raw material not found');
    return { id: String(item._id), productCode: item.productCode };
  }

  async findAll(query: ListRawMaterialsQuery) {
    const filter: Record<string, unknown> = {};
    const hasSiteScope = Boolean(query.site?.trim());
    const siteNormalizedValues = hasSiteScope
      ? await this.resolveSiteNormalizedValues(query.site)
      : [];
    if (hasSiteScope) filter.productCode = /^IT/i;
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { name: new RegExp(this.escapeRegExp(text), 'i') },
        { productCode: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }
    if (hasSiteScope) {
      const siteMaterials = siteNormalizedValues.length
        ? await this.rawMaterialVendorPriceModel.distinct(
            'productCodeNormalized',
            {
              siteNormalized: { $in: siteNormalizedValues },
              productCodeNormalized: /^it/i,
            },
          )
        : [];
      filter.productCodeNormalized = { $in: siteMaterials };
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.rawMaterialModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.rawMaterialModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async findUnitOfMeasuresOptions() {
    const values = await this.rawMaterialModel.distinct('unitOfMeasures', {
      unitOfMeasures: { $type: 'string', $ne: '' },
    });
    return values
      .map((value) => String(value).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  async findExistingProductCodes(productCodes: string[]) {
    const normalizedCodes = Array.from(
      new Set(
        productCodes
          .map((productCode) => this.normalizeProductCode(productCode))
          .filter(Boolean),
      ),
    );
    if (normalizedCodes.length === 0) return new Set<string>();

    const items = await this.rawMaterialModel
      .find({ productCodeNormalized: { $in: normalizedCodes } })
      .select({ productCodeNormalized: 1 })
      .lean<Array<{ productCodeNormalized: string }>>();
    return new Set(items.map((item) => item.productCodeNormalized));
  }

  async findVendorPrices(query: ListRawMaterialVendorPricesQuery) {
    const productCodeNormalized = this.normalizeProductCode(query.productCode);
    if (!productCodeNormalized) return [];

    const filter: Record<string, unknown> = { productCodeNormalized };
    const siteNormalizedValues = await this.resolveSiteNormalizedValues(
      query.site,
    );
    const vendorNormalized = this.normalizeOptionalText(
      query.vendor,
    )?.toLowerCase();
    if (siteNormalizedValues.length) {
      filter.siteNormalized = { $in: siteNormalizedValues };
    }
    if (vendorNormalized) filter.vendorNormalized = vendorNormalized;

    const items = await this.rawMaterialVendorPriceModel
      .find(filter)
      .sort({ site: 1, vendor: 1, updatedAt: -1, minimumQuantity: 1 })
      .limit(500)
      .lean<
        Array<
          RawMaterialVendorPrice & {
            _id: unknown;
            updatedAt?: Date;
          }
        >
      >();

    const latestByVendor = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      const key = siteNormalizedValues.length
        ? [item.productCodeNormalized, item.vendorNormalized].join('|')
        : [
            item.productCodeNormalized,
            item.siteNormalized,
            item.vendorNormalized,
          ].join('|');
      const existing = latestByVendor.get(key);
      const itemUpdatedAt = new Date(item.updatedAt ?? 0).getTime();
      const existingUpdatedAt = new Date(existing?.updatedAt ?? 0).getTime();
      if (!existing || itemUpdatedAt > existingUpdatedAt) {
        latestByVendor.set(key, item);
      }
    }

    return Array.from(latestByVendor.values());
  }

  async bulkUpsertByProductCode(rows: RawMaterialUpsertInput[]) {
    if (rows.length === 0) {
      return {
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      };
    }

    const latestByCode = new Map<string, RawMaterialUpsertInput>();
    for (const row of rows) {
      const normalizedCode = this.normalizeProductCode(row.productCode);
      if (normalizedCode) latestByCode.set(normalizedCode, row);
    }

    const operations = Array.from(latestByCode.entries()).map(
      ([normalizedCode, row]) => {
        const productCode = row.productCode.trim();
        const name = row.name.trim();
        const unitOfMeasures = row.unitOfMeasures.trim();
        const updateFields: Record<string, unknown> = {
          productCode,
          name,
          unitOfMeasures,
        };
        const baseUnitOfMeasures = this.normalizeOptionalText(
          row.baseUnitOfMeasures,
        );
        const conversionFactor = this.normalizePositiveOptionalNumber(
          row.conversionFactor,
        );
        if (baseUnitOfMeasures !== undefined) {
          updateFields.baseUnitOfMeasures = baseUnitOfMeasures;
        }
        if (conversionFactor !== undefined) {
          updateFields.conversionFactor = conversionFactor;
        }
        const vendor = this.normalizeOptionalText(row.vendor);
        const currency = this.normalizeOptionalText(row.currency);
        if (vendor !== undefined) updateFields.vendor = vendor;
        if (currency !== undefined) updateFields.currency = currency;
        if (row.minimumQuantity !== undefined) {
          updateFields.minimumQuantity = row.minimumQuantity;
        }
        if (row.price !== undefined) {
          updateFields.price = this.getUnitPrice(row) ?? row.price;
        }
        if (row.extraFields !== undefined) {
          updateFields.extraFields = row.extraFields;
        }

        return {
          updateOne: {
            filter: { productCodeNormalized: normalizedCode },
            update: {
              $setOnInsert: {
                ...updateFields,
                productCodeNormalized: normalizedCode,
              },
            },
            upsert: true,
          },
        };
      },
    );

    const result = await this.rawMaterialModel.bulkWrite(operations, {
      ordered: false,
    });

    return {
      insertedCount: result.insertedCount ?? 0,
      matchedCount: result.matchedCount ?? 0,
      modifiedCount: result.modifiedCount ?? 0,
      upsertedCount: result.upsertedCount ?? 0,
    };
  }

  async bulkUpsertVendorPrices(rows: RawMaterialVendorPriceUpsertInput[]) {
    const validRows = rows
      .map((row) => this.normalizeVendorPriceRow(row))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (validRows.length === 0) {
      return {
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      };
    }

    const latestByKey = new Map<string, (typeof validRows)[number]>();
    for (const row of validRows) {
      const key = [
        row.productCodeNormalized,
        row.siteNormalized,
        row.vendorNormalized,
        row.currencyNormalized ?? '',
        row.unitOfMeasuresNormalized,
        row.minimumQuantity ?? '',
      ].join('|');
      const existing = latestByKey.get(key);
      if (!existing || this.isHigherUnitPrice(row, existing)) {
        latestByKey.set(key, row);
      }
    }

    const operations = Array.from(latestByKey.values()).map((row) => ({
      updateOne: {
        filter: {
          productCodeNormalized: row.productCodeNormalized,
          siteNormalized: row.siteNormalized,
          vendorNormalized: row.vendorNormalized,
          currencyNormalized: row.currencyNormalized,
          unitOfMeasuresNormalized: row.unitOfMeasuresNormalized,
          minimumQuantity: row.minimumQuantity,
        },
        update: {
          $set: {
            productCode: row.productCode,
            name: row.name,
            unitOfMeasures: row.unitOfMeasures,
            site: row.site,
            vendor: row.vendor,
            ...(row.currency !== undefined ? { currency: row.currency } : {}),
            ...(row.currencyNormalized !== undefined
              ? { currencyNormalized: row.currencyNormalized }
              : {}),
            ...(row.minimumQuantity !== undefined
              ? { minimumQuantity: row.minimumQuantity }
              : {}),
            ...(row.price !== undefined ? { price: row.price } : {}),
            ...(row.priceQuantity !== undefined
              ? { priceQuantity: row.priceQuantity }
              : {}),
            ...(row.extraFields !== undefined
              ? { extraFields: row.extraFields }
              : {}),
          },
          $setOnInsert: {
            productCodeNormalized: row.productCodeNormalized,
            siteNormalized: row.siteNormalized,
            vendorNormalized: row.vendorNormalized,
            unitOfMeasuresNormalized: row.unitOfMeasuresNormalized,
          },
        },
        upsert: true,
      },
    }));

    const result = await this.rawMaterialVendorPriceModel.bulkWrite(
      operations,
      {
        ordered: false,
      },
    );

    return {
      insertedCount: result.insertedCount ?? 0,
      matchedCount: result.matchedCount ?? 0,
      modifiedCount: result.modifiedCount ?? 0,
      upsertedCount: result.upsertedCount ?? 0,
    };
  }

  async bulkUpdatePricesByProductCode(
    rows:
      | Iterable<RawMaterialPriceUpdateInput>
      | AsyncIterable<RawMaterialPriceUpdateInput>,
  ) {
    const masterPriceByCode = new Map<string, RawMaterialPriceUpdateInput>();
    const vendorPriceByKey = new Map<string, RawMaterialPriceUpdateInput>();
    const sourceProductCodes = new Map<string, string>();
    const rowCountByCode = new Map<string, number>();
    const conflictingVendorKeys = new Set<string>();
    let requestedCount = 0;
    let vendorPriceRequestedCount = 0;
    let duplicateVendorPriceRowCount = 0;
    let priceQuantityAdjustedCount = 0;
    const updateDate = this.getDateOnly(new Date());

    for await (const input of rows) {
      requestedCount += 1;
      const productCode = input.productCode?.trim() ?? '';
      const normalizedCode = this.normalizeProductCode(productCode);
      if (
        !normalizedCode ||
        typeof input.price !== 'number' ||
        !Number.isFinite(input.price) ||
        input.price < 0
      ) {
        continue;
      }

      sourceProductCodes.set(normalizedCode, productCode);
      rowCountByCode.set(
        normalizedCode,
        (rowCountByCode.get(normalizedCode) ?? 0) + 1,
      );
      const site = this.normalizeOptionalText(input.site);
      const vendor = this.normalizeOptionalText(input.vendor);

      if (site && vendor) {
        vendorPriceRequestedCount += 1;
        if (input.priceQuantity !== undefined && input.priceQuantity !== 1) {
          priceQuantityAdjustedCount += 1;
        }
        const vendorKey = [
          normalizedCode,
          this.normalizeSiteKey(site),
          vendor.toLowerCase(),
        ].join('|');
        const row: RawMaterialPriceUpdateInput = {
          ...input,
          productCode,
          site,
          vendor,
        };
        const existing = vendorPriceByKey.get(vendorKey);
        if (existing) {
          duplicateVendorPriceRowCount += 1;
          if (this.getUnitPrice(existing) !== this.getUnitPrice(row)) {
            conflictingVendorKeys.add(vendorKey);
          }
        }
        if (
          !existing ||
          this.isPreferredVendorPrice(row, existing, updateDate)
        ) {
          vendorPriceByKey.set(vendorKey, row);
        }
      } else {
        masterPriceByCode.set(normalizedCode, {
          ...input,
          productCode,
        });
      }
    }

    const mode: RawMaterialPriceUpdateMode = vendorPriceByKey.size
      ? masterPriceByCode.size
        ? 'mixed'
        : 'vendor'
      : 'master';
    const normalizedCodes = Array.from(sourceProductCodes.keys());
    const existing = normalizedCodes.length
      ? await this.rawMaterialModel
          .find({ productCodeNormalized: { $in: normalizedCodes } })
          .select({
            _id: 1,
            productCode: 1,
            productCodeNormalized: 1,
            name: 1,
            unitOfMeasures: 1,
          })
          .lean<
            Array<{
              _id: unknown;
              productCode: string;
              productCodeNormalized: string;
              name: string;
              unitOfMeasures: string;
            }>
          >()
      : [];
    const existingByCode = new Map(
      existing.map((item) => [item.productCodeNormalized, item]),
    );
    const notFoundCodes = normalizedCodes.filter(
      (code) => !existingByCode.has(code),
    );
    const notFoundRowCount = notFoundCodes.reduce(
      (sum, code) => sum + (rowCountByCode.get(code) ?? 0),
      0,
    );

    const masterOperations = Array.from(masterPriceByCode.entries())
      .filter(([code]) => existingByCode.has(code))
      .map(([code, row]) => ({
        updateOne: {
          filter: { productCodeNormalized: code },
          update: {
            $set: {
              price: this.getUnitPrice(row) ?? row.price,
            },
          },
        },
      }));
    let masterMatchedCount = 0;
    let masterModifiedCount = 0;
    for (const operations of this.chunkItems(masterOperations, 1000)) {
      const result = await this.rawMaterialModel.bulkWrite(operations, {
        ordered: false,
      });
      masterMatchedCount += result.matchedCount ?? 0;
      masterModifiedCount += result.modifiedCount ?? 0;
    }

    const normalizedVendorPrices = new Map<
      string,
      NonNullable<ReturnType<RawMaterialsService['normalizeVendorPriceRow']>>
    >();
    for (const [vendorKey, row] of vendorPriceByKey) {
      if (row.startDate && row.startDate > updateDate) continue;
      const rawMaterial = existingByCode.get(
        this.normalizeProductCode(row.productCode),
      );
      if (!rawMaterial) continue;
      const normalized = this.normalizeVendorPriceRow({
        productCode: rawMaterial.productCode,
        name: this.normalizeOptionalText(row.name) ?? rawMaterial.name,
        unitOfMeasures:
          this.normalizeOptionalText(row.unitOfMeasures) ??
          rawMaterial.unitOfMeasures,
        site: row.site,
        vendor: row.vendor,
        currency: row.currency,
        minimumQuantity: row.minimumQuantity,
        price: row.price,
        priceQuantity: row.priceQuantity,
        startDate: row.startDate,
      });
      if (normalized) normalizedVendorPrices.set(vendorKey, normalized);
    }
    vendorPriceByKey.clear();

    type ExistingVendorPrice = RawMaterialVendorPrice & {
      _id: unknown;
      updatedAt?: Date;
    };
    const vendorProductCodes = Array.from(
      new Set(
        Array.from(normalizedVendorPrices.values()).map(
          (row) => row.productCodeNormalized,
        ),
      ),
    );
    const existingVendorPrices = vendorProductCodes.length
      ? await this.rawMaterialVendorPriceModel
          .find({ productCodeNormalized: { $in: vendorProductCodes } })
          .select({
            _id: 1,
            productCodeNormalized: 1,
            siteNormalized: 1,
            vendorNormalized: 1,
            currencyNormalized: 1,
            unitOfMeasuresNormalized: 1,
            minimumQuantity: 1,
            updatedAt: 1,
          })
          .lean<ExistingVendorPrice[]>()
      : [];
    const existingByVendor = new Map<string, ExistingVendorPrice[]>();
    for (const item of existingVendorPrices) {
      const key = [
        item.productCodeNormalized,
        this.normalizeSiteKey(item.siteNormalized),
        item.vendorNormalized,
      ].join('|');
      const group = existingByVendor.get(key) ?? [];
      group.push(item);
      existingByVendor.set(key, group);
    }

    let vendorPriceMatchedCount = 0;
    let vendorPriceModifiedCount = 0;
    let vendorPriceUpsertedCount = 0;
    let vendorPriceDuplicateRemovedCount = 0;
    let vendorOperations: unknown[] = [];
    const flushVendorOperations = async () => {
      if (vendorOperations.length === 0) return;
      const result = await this.rawMaterialVendorPriceModel.bulkWrite(
        vendorOperations as never,
        { ordered: false },
      );
      vendorPriceMatchedCount += result.matchedCount ?? 0;
      vendorPriceModifiedCount += result.modifiedCount ?? 0;
      vendorPriceUpsertedCount += result.upsertedCount ?? 0;
      vendorPriceDuplicateRemovedCount += result.deletedCount ?? 0;
      vendorOperations = [];
    };

    for (const [vendorKey, row] of normalizedVendorPrices) {
      const previous = existingByVendor.get(vendorKey) ?? [];
      const fullKey = this.getVendorPriceFullKey(row);
      const canonical =
        previous.find((item) => this.getVendorPriceFullKey(item) === fullKey) ??
        previous
          .slice()
          .sort(
            (a, b) =>
              new Date(b.updatedAt ?? 0).getTime() -
              new Date(a.updatedAt ?? 0).getTime(),
          )[0];
      const duplicateIds = previous
        .filter((item) => String(item._id) !== String(canonical?._id))
        .map((item) => item._id);
      const setFields = {
        productCode: row.productCode,
        productCodeNormalized: row.productCodeNormalized,
        name: row.name,
        unitOfMeasures: row.unitOfMeasures,
        unitOfMeasuresNormalized: row.unitOfMeasuresNormalized,
        site: row.site,
        siteNormalized: row.siteNormalized,
        vendor: row.vendor,
        vendorNormalized: row.vendorNormalized,
        ...(row.currency !== undefined ? { currency: row.currency } : {}),
        ...(row.currencyNormalized !== undefined
          ? { currencyNormalized: row.currencyNormalized }
          : {}),
        ...(row.minimumQuantity !== undefined
          ? { minimumQuantity: row.minimumQuantity }
          : {}),
        ...(row.price !== undefined ? { price: row.price } : {}),
        ...(row.priceQuantity !== undefined
          ? { priceQuantity: row.priceQuantity }
          : {}),
        ...(row.startDate !== undefined ? { startDate: row.startDate } : {}),
      };
      const unsetFields = {
        ...(row.currency === undefined ? { currency: 1 } : {}),
        ...(row.currencyNormalized === undefined
          ? { currencyNormalized: 1 }
          : {}),
        ...(row.minimumQuantity === undefined ? { minimumQuantity: 1 } : {}),
        ...(row.priceQuantity === undefined ? { priceQuantity: 1 } : {}),
        ...(row.startDate === undefined ? { startDate: 1 } : {}),
      };
      const updateOperation = canonical
        ? {
            updateOne: {
              filter: { _id: canonical._id },
              update: {
                $set: setFields,
                ...(Object.keys(unsetFields).length
                  ? { $unset: unsetFields }
                  : {}),
              },
            },
          }
        : {
            updateOne: {
              filter: {
                productCodeNormalized: row.productCodeNormalized,
                siteNormalized: row.siteNormalized,
                vendorNormalized: row.vendorNormalized,
                currencyNormalized: row.currencyNormalized,
                unitOfMeasuresNormalized: row.unitOfMeasuresNormalized,
                minimumQuantity: row.minimumQuantity,
              },
              update: { $set: setFields },
              upsert: true,
            },
          };

      vendorOperations.push(updateOperation);
      if (duplicateIds.length) {
        vendorOperations.push({
          deleteMany: {
            filter: { _id: { $in: duplicateIds } },
          },
        });
      }
      if (vendorOperations.length >= 5000) await flushVendorOperations();
    }
    await flushVendorOperations();

    return {
      mode,
      requestedCount,
      matchedCount: masterMatchedCount,
      modifiedCount: masterModifiedCount,
      matchedProductCount: existingByCode.size,
      notFoundCount: notFoundCodes.length,
      notFoundRowCount,
      notFoundProductCodes: notFoundCodes
        .map((code) => sourceProductCodes.get(code) ?? code)
        .slice(0, 20),
      vendorPriceRequestedCount,
      vendorPriceUniqueCount: normalizedVendorPrices.size,
      vendorPriceMatchedCount,
      vendorPriceModifiedCount,
      vendorPriceUpsertedCount,
      vendorPriceDuplicateRemovedCount,
      duplicateVendorPriceRowCount,
      conflictingVendorPriceCount: conflictingVendorKeys.size,
      priceQuantityAdjustedCount,
    };
  }

  async bulkUpdateSpecificConversions(
    input: BulkUpdateSpecificConversionsInput,
  ) {
    const rawMaterialIds = Array.from(
      new Set(input.rawMaterialIds.map((id) => id.trim()).filter(Boolean)),
    );
    if (rawMaterialIds.length === 0) {
      throw new BadRequestException(
        'Select at least one raw material for the bulk update.',
      );
    }

    const baseUnitOfMeasures = this.normalizeUomCode(input.baseUnitOfMeasures);
    const conversionFactor = this.normalizePositiveOptionalNumber(
      input.conversionFactor,
    );
    if (!baseUnitOfMeasures || conversionFactor === undefined) {
      throw new BadRequestException(
        'Base unit and conversion factor greater than 0 are required.',
      );
    }

    const unitOfMeasures = this.normalizeUomCode(input.unitOfMeasures);
    if (!unitOfMeasures) {
      throw new BadRequestException('SR unit is required.');
    }
    if (unitOfMeasures === baseUnitOfMeasures) {
      throw new BadRequestException(
        'Production unit must be different from SR unit.',
      );
    }

    const filter: Record<string, unknown> = {
      _id: { $in: rawMaterialIds },
    };

    const rawMaterials = await this.rawMaterialModel
      .find(filter)
      .select({
        _id: 1,
        unitOfMeasures: 1,
        baseUnitOfMeasures: 1,
        conversionFactor: 1,
        specificConversions: 1,
      })
      .lean();

    const nextRule: RawMaterialSpecificConversion = {
      prodUomCode: this.normalizeUomCode(baseUnitOfMeasures),
      srUomCode: this.normalizeUomCode(unitOfMeasures),
      conversionFactor,
    };
    const operations = rawMaterials.map((rawMaterial) => {
      const currentRules = this.getSpecificConversionsWithLegacy(rawMaterial);
      const nextKey = this.getSpecificConversionKey(nextRule);
      const nextRules = [
        ...currentRules.filter(
          (rule) => this.getSpecificConversionKey(rule) !== nextKey,
        ),
        nextRule,
      ];

      return {
        updateOne: {
          filter: { _id: rawMaterial._id },
          update: {
            $set: { specificConversions: nextRules },
            $unset: {
              baseUnitOfMeasures: 1 as const,
              conversionFactor: 1 as const,
            },
          },
        },
      };
    });

    const result = operations.length
      ? await this.rawMaterialModel.bulkWrite(operations, { ordered: false })
      : null;

    return {
      requestedCount: rawMaterialIds.length,
      matchedCount: rawMaterials.length,
      modifiedCount: result?.modifiedCount ?? 0,
    };
  }

  private normalizeSpecificConversions(
    rules: RawMaterialSpecificConversion[],
  ): RawMaterialSpecificConversion[] {
    const normalizedByKey = new Map<string, RawMaterialSpecificConversion>();

    for (const rule of rules) {
      const prodUomCode = this.normalizeUomCode(rule.prodUomCode);
      const srUomCode = this.normalizeUomCode(rule.srUomCode);
      const conversionFactor = this.normalizePositiveOptionalNumber(
        rule.conversionFactor,
      );
      if (!prodUomCode || !srUomCode || conversionFactor === undefined) {
        throw new BadRequestException(
          'Each specific conversion requires production unit, SR unit, and conversion factor greater than 0.',
        );
      }
      if (prodUomCode === srUomCode) {
        throw new BadRequestException(
          'Production unit must be different from SR unit.',
        );
      }

      const normalized = { prodUomCode, srUomCode, conversionFactor };
      normalizedByKey.set(
        this.getSpecificConversionKey(normalized),
        normalized,
      );
    }

    return Array.from(normalizedByKey.values());
  }

  private getSpecificConversionsWithLegacy(rawMaterial: {
    unitOfMeasures?: string;
    baseUnitOfMeasures?: string;
    conversionFactor?: number;
    specificConversions?: RawMaterialSpecificConversion[];
  }) {
    const rules = this.normalizeSpecificConversions(
      rawMaterial.specificConversions ?? [],
    );
    const legacyProdUomCode = this.normalizeUomCode(
      rawMaterial.baseUnitOfMeasures,
    );
    const legacySrUomCode = this.normalizeUomCode(rawMaterial.unitOfMeasures);
    const legacyFactor = this.normalizePositiveOptionalNumber(
      rawMaterial.conversionFactor,
    );
    if (legacyProdUomCode && legacySrUomCode && legacyFactor !== undefined) {
      const legacyRule = {
        prodUomCode: legacyProdUomCode,
        srUomCode: legacySrUomCode,
        conversionFactor: legacyFactor,
      };
      const legacyKey = this.getSpecificConversionKey(legacyRule);
      if (
        !rules.some((rule) => this.getSpecificConversionKey(rule) === legacyKey)
      ) {
        rules.push(legacyRule);
      }
    }
    return rules;
  }

  private getSpecificConversionKey(rule: {
    prodUomCode: string;
    srUomCode: string;
  }) {
    return `${this.normalizeUomCode(rule.prodUomCode)}::${this.normalizeUomCode(
      rule.srUomCode,
    )}`;
  }

  private normalizeUomCode(value?: string) {
    return value?.trim().toUpperCase() ?? '';
  }

  private normalizeProductCode(productCode: string) {
    return productCode.trim().toLowerCase();
  }

  private normalizeVendorPriceRow(row: RawMaterialVendorPriceUpsertInput) {
    const productCode = row.productCode.trim();
    const name = row.name.trim();
    const unitOfMeasures = row.unitOfMeasures.trim();
    const site = this.normalizeOptionalText(row.site);
    const vendor = this.normalizeOptionalText(row.vendor);

    if (!productCode || !name || !unitOfMeasures || !site || !vendor) {
      return null;
    }
    const siteNormalized = this.normalizeSiteKey(site);
    if (!siteNormalized) return null;

    const currency = this.normalizeOptionalText(row.currency);
    const minimumQuantity = this.normalizeOptionalNumber(row.minimumQuantity);
    const price = this.normalizeOptionalNumber(row.price);
    const priceQuantity = this.normalizePositiveOptionalNumber(
      row.priceQuantity,
    );

    return {
      productCode,
      productCodeNormalized: this.normalizeProductCode(productCode),
      name,
      unitOfMeasures,
      unitOfMeasuresNormalized: unitOfMeasures.toLowerCase(),
      site,
      siteNormalized,
      vendor,
      vendorNormalized: vendor.toLowerCase(),
      currency,
      currencyNormalized: currency?.toLowerCase(),
      minimumQuantity,
      price,
      priceQuantity,
      startDate: row.startDate,
      extraFields: row.extraFields,
    };
  }

  private isHigherUnitPrice(
    next: { price?: number; priceQuantity?: number },
    current: { price?: number; priceQuantity?: number },
  ) {
    const nextPrice = this.getUnitPrice(next);
    const currentPrice = this.getUnitPrice(current);
    if (nextPrice === undefined) return currentPrice === undefined;
    if (currentPrice === undefined) return true;
    return nextPrice > currentPrice;
  }

  private isPreferredVendorPrice(
    next: { price?: number; priceQuantity?: number; startDate?: string },
    current: { price?: number; priceQuantity?: number; startDate?: string },
    updateDate: string,
  ) {
    const nextHasStartDate = Boolean(next.startDate);
    const currentHasStartDate = Boolean(current.startDate);
    const nextEligible = Boolean(
      next.startDate && next.startDate <= updateDate,
    );
    const currentEligible = Boolean(
      current.startDate && current.startDate <= updateDate,
    );

    if (nextEligible !== currentEligible) return nextEligible;
    if (nextEligible && currentEligible) {
      const nextValue = this.daysSinceStartDate(next.startDate!, updateDate);
      const currentValue = this.daysSinceStartDate(
        current.startDate!,
        updateDate,
      );
      if (nextValue !== currentValue) return nextValue < currentValue;
      return this.isHigherUnitPrice(next, current);
    }

    if (nextHasStartDate !== currentHasStartDate) return !nextHasStartDate;
    return this.isHigherUnitPrice(next, current);
  }

  private daysSinceStartDate(startDate: string, updateDate: string) {
    return (
      (Date.parse(`${updateDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000
    );
  }

  private getDateOnly(date: Date) {
    return `${date.getFullYear().toString().padStart(4, '0')}-${(
      date.getMonth() + 1
    )
      .toString()
      .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  }

  private getUnitPrice(input: { price?: number }): number | undefined {
    const price = this.normalizeOptionalNumber(input.price);
    if (price === undefined) return undefined;

    // Price-list prices are already the prices to use in the system. The
    // quantity column is descriptive metadata and must not rescale the price
    // (for example, 37,000 with quantity 0.1 must remain 37,000).
    return price;
  }

  private getVendorPriceFullKey(input: {
    productCodeNormalized: string;
    siteNormalized: string;
    vendorNormalized: string;
    currencyNormalized?: string;
    unitOfMeasuresNormalized: string;
    minimumQuantity?: number;
  }) {
    return [
      input.productCodeNormalized,
      input.siteNormalized,
      input.vendorNormalized,
      input.currencyNormalized ?? '',
      input.unitOfMeasuresNormalized,
      input.minimumQuantity ?? '',
    ].join('|');
  }

  private chunkItems<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private normalizeOptionalText(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private async resolveSiteNormalizedValues(site?: string) {
    const values = new Set<string>();
    const siteNormalized = this.normalizeSiteKey(site);
    if (siteNormalized) values.add(siteNormalized);
    const legacySiteNormalized = this.normalizeSiteKeyLegacy(site);
    if (legacySiteNormalized) values.add(legacySiteNormalized);

    const siteCode = this.normalizeOptionalText(site);
    if (siteCode) {
      const siteSummary = Array.from(
        (await this.sites.findSummariesByCodes([siteCode])).values(),
      )[0];
      const siteNameNormalized = this.normalizeSiteKey(siteSummary?.name);
      if (siteNameNormalized) values.add(siteNameNormalized);
      const legacySiteNameNormalized = this.normalizeSiteKeyLegacy(
        siteSummary?.name,
      );
      if (legacySiteNameNormalized) values.add(legacySiteNameNormalized);
    }

    return Array.from(values);
  }

  private normalizeSiteKeyLegacy(value?: string) {
    return this.normalizeOptionalText(value)?.toLowerCase();
  }

  private normalizeSiteKey(value?: string) {
    const normalized = this.normalizeOptionalText(value)
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return normalized || undefined;
  }

  private normalizeOptionalNumber(value?: number) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private normalizePositiveOptionalNumber(value?: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
