import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UnitConversion,
  UnitConversionDocument,
} from './schemas/unit-conversion.schema';
import {
  UnitOfMeasure,
  UnitOfMeasureDocument,
} from './schemas/unit-of-measure.schema';

type ListUnitsQuery = {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
};

type CreateUnitInput = {
  code: string;
  name: string;
};

type UpdateUnitInput = Partial<CreateUnitInput> & {
  isActive?: boolean;
};

type CreateConversionInput = {
  prodUomCode: string;
  srUomCode: string;
  multiplier: number;
  ext: number;
  weight: number;
};

type UpdateConversionInput = Partial<CreateConversionInput> & {
  isActive?: boolean;
};

@Injectable()
export class UnitOfMeasuresService {
  constructor(
    @InjectModel(UnitOfMeasure.name)
    private readonly unitModel: Model<UnitOfMeasureDocument>,
    @InjectModel(UnitConversion.name)
    private readonly conversionModel: Model<UnitConversionDocument>,
  ) {}

  async createUnit(input: CreateUnitInput) {
    const code = this.normalizeCode(input.code);
    const name = input.name.trim();
    if (!code || !name) {
      throw new BadRequestException('Unit code and name are required.');
    }

    try {
      return await this.unitModel.create({
        code,
        name,
        isActive: true,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Unit code already exists.');
      }
      throw error;
    }
  }

  async updateUnit(id: string, input: UpdateUnitInput) {
    this.assertObjectId(id, 'Invalid unit id.');

    const updateFields: UpdateUnitInput = {};
    if (input.code !== undefined) {
      const code = this.normalizeCode(input.code);
      if (!code) throw new BadRequestException('Unit code is required.');
      updateFields.code = code;
    }
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Unit name is required.');
      updateFields.name = name;
    }
    if (input.isActive !== undefined) {
      updateFields.isActive = input.isActive;
    }
    if (Object.keys(updateFields).length === 0) {
      throw new BadRequestException('No changes provided.');
    }

    try {
      const updated = await this.unitModel
        .findByIdAndUpdate(id, updateFields, { new: true })
        .lean();
      if (!updated) throw new NotFoundException('Unit not found.');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Unit code already exists.');
      }
      throw error;
    }
  }

  async deleteUnit(id: string) {
    this.assertObjectId(id, 'Invalid unit id.');
    const unit = await this.unitModel.findById(id).lean();
    if (!unit) throw new NotFoundException('Unit not found.');

    const usedByConversion = await this.conversionModel
      .exists({
        $or: [{ prodUomCode: unit.code }, { srUomCode: unit.code }],
      })
      .lean();
    if (usedByConversion) {
      throw new BadRequestException(
        'Unit is used by a conversion and cannot be deleted.',
      );
    }

    await this.unitModel.deleteOne({ _id: id });
    return { id };
  }

  async listUnits(query: ListUnitsQuery) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const filter = this.buildSearchFilter(query.search, ['code', 'name']);
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.unitModel
        .find(filter)
        .collation({ locale: 'en', numericOrdering: true })
        .sort({ code: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.unitModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async createConversion(input: CreateConversionInput) {
    const payload = await this.buildConversionPayload(input);

    try {
      return await this.conversionModel.create(payload);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Unit conversion already exists.');
      }
      throw error;
    }
  }

  async updateConversion(id: string, input: UpdateConversionInput) {
    this.assertObjectId(id, 'Invalid conversion id.');
    const existing = await this.conversionModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Unit conversion not found.');

    const merged = {
      prodUomCode: input.prodUomCode ?? existing.prodUomCode,
      srUomCode: input.srUomCode ?? existing.srUomCode,
      multiplier: input.multiplier ?? existing.multiplier,
      ext: input.ext ?? existing.ext,
      weight: input.weight ?? existing.weight,
      isActive: input.isActive ?? existing.isActive,
    };
    const payload = await this.buildConversionPayload(merged);

    try {
      const updated = await this.conversionModel
        .findByIdAndUpdate(id, payload, { new: true })
        .lean();
      if (!updated) throw new NotFoundException('Unit conversion not found.');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Unit conversion already exists.');
      }
      throw error;
    }
  }

  async deleteConversion(id: string) {
    this.assertObjectId(id, 'Invalid conversion id.');
    const deleted = await this.conversionModel.findByIdAndDelete(id).lean();
    if (!deleted) throw new NotFoundException('Unit conversion not found.');
    return { id };
  }

  async listConversions(query: ListUnitsQuery) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const filter = this.buildSearchFilter(query.search, [
      'prodUomCode',
      'srUomCode',
      'conversionId',
      'ext',
    ]);
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.conversionModel
        .find(filter)
        .collation({ locale: 'en', numericOrdering: true })
        .sort({ prodUomCode: 1, srUomCode: 1, conversionId: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.conversionModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private async buildConversionPayload(input: CreateConversionInput) {
    const prodUomCode = this.normalizeCode(input.prodUomCode);
    const srUomCode = this.normalizeCode(input.srUomCode);
    const multiplier = this.normalizePositiveNumber(input.multiplier);
    const ext = this.normalizePositiveNumber(input.ext);
    const weight = this.normalizePositiveNumber(input.weight);

    if (
      !prodUomCode ||
      !srUomCode ||
      !multiplier ||
      !ext ||
      !weight
    ) {
      throw new BadRequestException(
        'Prod UOM, SR UOM, multiplier, EXT, and weight are required.',
      );
    }
    if (prodUomCode === srUomCode) {
      throw new BadRequestException('Conversion units must be different.');
    }

    await this.assertUnitsExist([prodUomCode, srUomCode]);
    const calculatedMultiplier = this.calculateMultiplier(ext, weight);
    const conversionId = `${prodUomCode} To ${srUomCode}`;

    return {
      prodUomCode,
      srUomCode,
      conversionId,
      multiplier: calculatedMultiplier,
      ext,
      weight,
      isActive: true,
    };
  }

  private async assertUnitsExist(codes: string[]) {
    const uniqueCodes = Array.from(new Set(codes));
    const count = await this.unitModel.countDocuments({
      code: { $in: uniqueCodes },
    });
    if (count !== uniqueCodes.length) {
      throw new BadRequestException(
        'Conversion units must exist before they can be used.',
      );
    }
  }

  private buildSearchFilter(search: string | undefined, fields: string[]) {
    const filter: Record<string, unknown> = {};
    const text = search?.trim();
    if (!text) return filter;
    const regex = new RegExp(this.escapeRegExp(text), 'i');
    filter.$or = fields.map((field) => ({ [field]: regex }));
    return filter;
  }

  private assertObjectId(id: string, message: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(message);
    }
  }

  private normalizeCode(code?: string) {
    return code?.trim().toUpperCase().replace(/\s+/g, '_') ?? '';
  }

  private normalizePositiveNumber(value?: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return value;
  }

  private calculateMultiplier(ext: number, weight: number) {
    return this.roundUpNumber((1 / ext) / weight, 6);
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(page ?? 1));
  }

  private normalizeLimit(limit?: number) {
    return Math.min(100, Math.max(1, Math.trunc(limit ?? 20)));
  }

  private formatNumber(value: number) {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  private roundUpNumber(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.ceil(value * factor) / factor;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
