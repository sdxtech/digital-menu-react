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
} from './schemas/raw-material.schema';
import {
  RawMaterialVendorPrice,
  RawMaterialVendorPriceDocument,
} from './schemas/raw-material-vendor-price.schema';
import { Recipe, RecipeDocument } from '../recipes/schemas/recipe.schema';

export type RawMaterialUpsertInput = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  vendor?: string;
  currency?: string;
  minimumQuantity?: number;
  price?: number;
  extraFields?: Record<string, string>;
};

export type RawMaterialVendorPriceUpsertInput = RawMaterialUpsertInput & {
  site?: string;
};

export type RawMaterialPriceUpdateInput = {
  productCode: string;
  price: number;
  rowNumber?: number;
};

type ListRawMaterialsQuery = {
  page: number;
  limit: number;
  search?: string;
};

type ListRawMaterialVendorPricesQuery = {
  productCode: string;
  site?: string;
  vendor?: string;
};

export type RawMaterialLookup = {
  productCode: string;
  productCodeNormalized: string;
  unitOfMeasures: string;
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
  ) {}

  async create(input: RawMaterialUpsertInput) {
    const normalizedCode = this.normalizeProductCode(input.productCode);
    const vendor = this.normalizeOptionalText(input.vendor);
    const currency = this.normalizeOptionalText(input.currency);
    const minimumQuantity = this.normalizeOptionalNumber(input.minimumQuantity);
    const price = this.normalizeOptionalNumber(input.price);
    const extraFields = input.extraFields;

    const updateFields: Record<string, unknown> = {
      productCode: input.productCode.trim(),
      name: input.name.trim(),
      unitOfMeasures: input.unitOfMeasures.trim(),
    };
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
        name: 1,
        price: 1,
      })
      .lean<RawMaterialLookup[]>();
  }

  async updateById(id: string, input: RawMaterialUpsertInput) {
    const item = await this.rawMaterialModel.findById(id);
    if (!item) throw new NotFoundException('Raw material not found');

    const productCode = input.productCode.trim();
    const name = input.name.trim();
    const unitOfMeasures = input.unitOfMeasures.trim();
    const normalizedCode = this.normalizeProductCode(productCode);
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
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { name: new RegExp(this.escapeRegExp(text), 'i') },
        { productCode: new RegExp(this.escapeRegExp(text), 'i') },
      ];
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

  async findVendorPrices(query: ListRawMaterialVendorPricesQuery) {
    const productCodeNormalized = this.normalizeProductCode(query.productCode);
    if (!productCodeNormalized) return [];

    const filter: Record<string, unknown> = { productCodeNormalized };
    const siteNormalized = this.normalizeSiteKey(query.site);
    const vendorNormalized = this.normalizeOptionalText(
      query.vendor,
    )?.toLowerCase();
    if (siteNormalized) filter.siteNormalized = siteNormalized;
    if (vendorNormalized) filter.vendorNormalized = vendorNormalized;

    return this.rawMaterialVendorPriceModel
      .find(filter)
      .sort({ site: 1, vendor: 1, minimumQuantity: 1 })
      .limit(500)
      .lean();
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
        const vendor = this.normalizeOptionalText(row.vendor);
        const currency = this.normalizeOptionalText(row.currency);
        if (vendor !== undefined) updateFields.vendor = vendor;
        if (currency !== undefined) updateFields.currency = currency;
        if (row.minimumQuantity !== undefined) {
          updateFields.minimumQuantity = row.minimumQuantity;
        }
        if (row.price !== undefined) updateFields.price = row.price;
        if (row.extraFields !== undefined) {
          updateFields.extraFields = row.extraFields;
        }

        return {
          updateOne: {
            filter: { productCodeNormalized: normalizedCode },
            update: {
              $set: updateFields,
              $setOnInsert: {
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
      if (!existing || this.isHigherPrice(row.price, existing.price)) {
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

  async bulkUpdatePricesByProductCode(rows: RawMaterialPriceUpdateInput[]) {
    const validRows = rows.filter(
      (row) =>
        row.productCode.trim() &&
        typeof row.price === 'number' &&
        Number.isFinite(row.price) &&
        row.price >= 0,
    );

    if (validRows.length === 0) {
      return {
        requestedCount: rows.length,
        matchedCount: 0,
        modifiedCount: 0,
        notFoundCount: 0,
        notFoundProductCodes: [],
      };
    }

    const priceByCode = new Map<string, RawMaterialPriceUpdateInput>();
    for (const row of validRows) {
      priceByCode.set(this.normalizeProductCode(row.productCode), row);
    }

    const normalizedCodes = Array.from(priceByCode.keys());
    const existing = await this.rawMaterialModel
      .find({ productCodeNormalized: { $in: normalizedCodes } })
      .select({ productCode: 1, productCodeNormalized: 1 })
      .lean<Array<{ productCode: string; productCodeNormalized: string }>>();
    const existingCodes = new Set(
      existing.map((item) => item.productCodeNormalized),
    );
    const operations = normalizedCodes
      .filter((code) => existingCodes.has(code))
      .map((code) => ({
        updateOne: {
          filter: { productCodeNormalized: code },
          update: {
            $set: {
              price: priceByCode.get(code)?.price ?? 0,
            },
          },
        },
      }));

    const result = operations.length
      ? await this.rawMaterialModel.bulkWrite(operations, { ordered: false })
      : null;
    const notFoundProductCodes = normalizedCodes
      .filter((code) => !existingCodes.has(code))
      .map((code) => priceByCode.get(code)?.productCode.trim() ?? code);

    return {
      requestedCount: rows.length,
      matchedCount: result?.matchedCount ?? 0,
      modifiedCount: result?.modifiedCount ?? 0,
      notFoundCount: notFoundProductCodes.length,
      notFoundProductCodes: notFoundProductCodes.slice(0, 20),
    };
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
      extraFields: row.extraFields,
    };
  }

  private isHigherPrice(next?: number, current?: number) {
    if (next === undefined) return current === undefined;
    if (current === undefined) return true;
    return next > current;
  }

  private normalizeOptionalText(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
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

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
