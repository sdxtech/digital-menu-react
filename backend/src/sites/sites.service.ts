import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Site, SiteDocument } from './schemas/site.schema';

type ListSitesQuery = {
  search?: string;
  active?: boolean;
};

type CreateSiteInput = {
  code: string;
  name: string;
};

type UpdateSiteInput = {
  name?: string;
  isActive?: boolean;
};

@Injectable()
export class SitesService {
  constructor(
    @InjectModel(Site.name) private readonly siteModel: Model<SiteDocument>,
  ) {}

  async create(input: CreateSiteInput) {
    const code = this.normalizeCode(input.code);
    const name = this.normalizeName(input.name);

    await this.assertNoConflicts({ code, name });

    return this.siteModel.create({
      code,
      name,
      isActive: true,
    });
  }

  async list(query: ListSitesQuery = {}) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { code: new RegExp(this.escapeRegExp(text), 'i') },
        { name: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }
    if (query.active !== undefined) {
      filter.isActive = query.active;
    }

    const items = await this.siteModel
      .find(filter)
      .sort({ code: 1, name: 1 })
      .lean();

    return { items };
  }

  async findByCode(code?: string) {
    const normalizedCode = code?.trim().toUpperCase();
    if (!normalizedCode) return null;

    return this.siteModel.findOne({ code: normalizedCode }).lean();
  }

  async update(id: string, input: UpdateSiteInput) {
    const site = await this.siteModel.findById(id);
    if (!site) throw new NotFoundException('Site not found');

    const nextName =
      input.name !== undefined ? this.normalizeName(input.name) : undefined;
    const hasIsActiveUpdate = input.isActive !== undefined;

    if (nextName === undefined && !hasIsActiveUpdate) {
      throw new BadRequestException('No changes provided');
    }

    if (nextName && nextName !== site.name) {
      await this.assertNoConflicts({ name: nextName }, site.id);
      site.name = nextName;
    }

    if (hasIsActiveUpdate) {
      site.isActive = Boolean(input.isActive);
    }

    await site.save();
    return site.toObject();
  }

  private async assertNoConflicts(
    input: { code?: string; name?: string },
    excludeId?: string,
  ) {
    if (input.code) {
      const existingCode = await this.siteModel.findOne({
        code: input.code,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      });
      if (existingCode) {
        throw new ConflictException('Site code already exists');
      }
    }

    if (input.name) {
      const existingName = await this.siteModel
        .findOne({
          name: input.name,
          ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        })
        .collation({ locale: 'en', strength: 2 });
      if (existingName) {
        throw new ConflictException('Site name already exists');
      }
    }
  }

  private normalizeCode(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('Site code is required');
    }
    return normalized;
  }

  private normalizeName(value: string) {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException('Site name is required');
    }
    return normalized;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
