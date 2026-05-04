import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Site, SiteDocument } from './schemas/site.schema';

export type CreateSiteInput = {
  name: string;
  code: string;
  description?: string;
  isActive?: boolean;
};

export type UpdateSiteInput = Partial<CreateSiteInput>;

export type ListSitesQuery = {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
};

export type SiteSummary = {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
};

@Injectable()
export class SitesService {
  constructor(
    @InjectModel(Site.name)
    private readonly siteModel: Model<SiteDocument>,
  ) {}

  async create(input: CreateSiteInput) {
    const name = input.name.trim();
    const code = this.normalizeCode(input.code);
    if (!name || !code) {
      throw new BadRequestException('Site name and code are required.');
    }

    try {
      return await this.siteModel.create({
        name,
        code,
        description: this.normalizeOptionalText(input.description),
        isActive: input.isActive ?? true,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Site code already exists');
      }
      throw error;
    }
  }

  async createWithNextSequentialCode(name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new BadRequestException('Site name is required.');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = await this.nextSequentialCode();
      try {
        return await this.create({
          name: normalizedName,
          code,
          isActive: true,
        });
      } catch (error) {
        if (error instanceof ConflictException) continue;
        throw error;
      }
    }

    throw new ConflictException('Failed to reserve next site code');
  }

  async update(id: string, input: UpdateSiteInput) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }

    const updateFields: UpdateSiteInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Site name is required.');
      updateFields.name = name;
    }
    if (input.code !== undefined) {
      const code = this.normalizeCode(input.code);
      if (!code) throw new BadRequestException('Site code is required.');
      updateFields.code = code;
    }
    if (input.description !== undefined) {
      updateFields.description = input.description.trim();
    }
    if (input.isActive !== undefined) {
      updateFields.isActive = input.isActive;
    }

    if (Object.keys(updateFields).length === 0) {
      throw new BadRequestException('No changes provided');
    }

    try {
      const updated = await this.siteModel.findByIdAndUpdate(id, updateFields, {
        new: true,
      });
      if (!updated) throw new NotFoundException('Site not found');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Site code already exists');
      }
      throw error;
    }
  }

  async setActive(id: string, isActive: boolean) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }

    const updated = await this.siteModel.findByIdAndUpdate(
      id,
      { isActive },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Site not found');
    return updated;
  }

  async softDelete(id: string) {
    return this.setActive(id, false);
  }

  async findAll(query: ListSitesQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { name: new RegExp(this.escapeRegExp(text), 'i') },
        { code: new RegExp(this.escapeRegExp(text), 'i') },
        { description: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.siteModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.siteModel.countDocuments(filter),
    ]);

    return {
      items: items.map((site) => this.toSummary(site)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }
    const site = await this.siteModel.findById(id);
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  async findSummaryById(id?: string | Types.ObjectId | null) {
    const normalizedId = this.normalizeId(id);
    if (!normalizedId) return null;

    const site = await this.siteModel.findById(normalizedId).lean();
    return site ? this.toSummary(site) : null;
  }

  async findSummariesByIds(
    ids: Array<string | Types.ObjectId | undefined | null>,
  ) {
    const normalizedIds = Array.from(
      new Set(
        ids
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (normalizedIds.length === 0) return new Map<string, SiteSummary>();

    const sites = await this.siteModel
      .find({ _id: { $in: normalizedIds } })
      .lean();
    const map = new Map<string, SiteSummary>();
    sites.forEach((site) => {
      map.set(String(site._id), this.toSummary(site));
    });
    return map;
  }

  async findSummariesByCodes(codes: string[]) {
    const normalizedCodes = Array.from(
      new Set(codes.map((code) => this.normalizeCode(code)).filter(Boolean)),
    );
    if (normalizedCodes.length === 0) return new Map<string, SiteSummary>();

    const sites = await this.siteModel
      .find({ code: { $in: normalizedCodes } })
      .lean();
    const map = new Map<string, SiteSummary>();
    sites.forEach((site) => {
      map.set(site.code, this.toSummary(site));
    });
    return map;
  }

  toSummary(site: {
    _id: unknown;
    name: string;
    code: string;
    description?: string;
    isActive?: boolean;
  }): SiteSummary {
    return {
      id: String(site._id),
      name: site.name,
      code: site.code,
      description: site.description,
      isActive: site.isActive ?? true,
    };
  }

  private normalizeCode(value?: string) {
    return (value ?? '').trim().replace(/\s+/g, '-').toUpperCase();
  }

  private async nextSequentialCode() {
    const sites = await this.siteModel
      .find({ code: /^S\d{3}$/ })
      .select({ code: 1 })
      .lean();
    const lastNumber = sites.reduce((max, site) => {
      const match = /^S(\d{3})$/.exec(site.code);
      if (!match) return max;
      return Math.max(max, Number(match[1]));
    }, 0);

    return `S${String(lastNumber + 1).padStart(3, '0')}`;
  }

  private normalizeOptionalText(value?: string) {
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private normalizeId(id?: string | Types.ObjectId | null) {
    if (!id) return undefined;
    const value = String(id);
    return Types.ObjectId.isValid(value) ? value : undefined;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
