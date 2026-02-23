import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RawMaterial, RawMaterialDocument } from './schemas/raw-material.schema';

export type RawMaterialUpsertInput = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  site?: string;
  vendor?: string;
  currency?: string;
  minimumQuantity?: number;
  price?: number;
  extraFields?: Record<string, string>;
};

type ListRawMaterialsQuery = {
  page: number;
  limit: number;
  search?: string;
};

@Injectable()
export class RawMaterialsService {
  constructor(
    @InjectModel(RawMaterial.name)
    private readonly rawMaterialModel: Model<RawMaterialDocument>,
  ) {}

  async create(input: RawMaterialUpsertInput) {
    const normalizedCode = this.normalizeProductCode(input.productCode);
    const site = this.normalizeOptionalText(input.site);
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
    if (site !== undefined) updateFields.site = site;
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
      ...(site !== undefined ? { site } : {}),
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

  async updateById(id: string, input: RawMaterialUpsertInput) {
    const item = await this.rawMaterialModel.findById(id);
    if (!item) throw new NotFoundException('Raw material not found');

    const productCode = input.productCode.trim();
    const name = input.name.trim();
    const unitOfMeasures = input.unitOfMeasures.trim();
    const normalizedCode = this.normalizeProductCode(productCode);
    const site = this.normalizeOptionalText(input.site);
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
    if (site !== undefined) item.site = site;
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

  async bulkUpsertByProductCode(rows: RawMaterialUpsertInput[]) {
    if (rows.length === 0) {
      return {
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      };
    }

    const operations = rows.map((row) => {
      const productCode = row.productCode.trim();
      const name = row.name.trim();
      const unitOfMeasures = row.unitOfMeasures.trim();
      const normalizedCode = this.normalizeProductCode(productCode);
      const site = this.normalizeOptionalText(row.site);
      const vendor = this.normalizeOptionalText(row.vendor);
      const currency = this.normalizeOptionalText(row.currency);
      const minimumQuantity = this.normalizeOptionalNumber(row.minimumQuantity);
      const price = this.normalizeOptionalNumber(row.price);
      const updateFields: Record<string, unknown> = {
        productCode,
        name,
        unitOfMeasures,
      };
      if (site !== undefined) updateFields.site = site;
      if (vendor !== undefined) updateFields.vendor = vendor;
      if (currency !== undefined) updateFields.currency = currency;
      if (minimumQuantity !== undefined) {
        updateFields.minimumQuantity = minimumQuantity;
      }
      if (price !== undefined) updateFields.price = price;
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
    });

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

  private normalizeProductCode(productCode: string) {
    return productCode.trim().toLowerCase();
  }

  private normalizeOptionalText(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private normalizeOptionalNumber(value?: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
