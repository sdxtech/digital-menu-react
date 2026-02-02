import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RawMaterial, RawMaterialDocument } from './schemas/raw-material.schema';

export type RawMaterialUpsertInput = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
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

    const existing = await this.rawMaterialModel.findOneAndUpdate(
      { productCodeNormalized: normalizedCode },
      {
        $set: {
          productCode: input.productCode.trim(),
          name: input.name.trim(),
          unitOfMeasures: input.unitOfMeasures.trim(),
        },
      },
      { new: true },
    );

    if (existing) return existing;

    return this.rawMaterialModel.create({
      productCode: input.productCode.trim(),
      productCodeNormalized: normalizedCode,
      name: input.name.trim(),
      unitOfMeasures: input.unitOfMeasures.trim(),
    });
  }

  async findById(id: string) {
    const item = await this.rawMaterialModel.findById(id).lean();
    if (!item) throw new NotFoundException('Raw material not found');
    return item;
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

      return {
        updateOne: {
          filter: { productCodeNormalized: normalizedCode },
          update: {
            $set: {
              productCode,
              name,
              unitOfMeasures,
            },
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

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

