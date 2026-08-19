import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SitesService } from '../sites/sites.service';
import { Client, ClientDocument } from './schemas/client.schema';

type ClientInput = {
  name?: string;
  clientId?: string;
  siteIds?: string[];
};

type ListClientsQuery = {
  page: number;
  limit: number;
  search?: string;
};

@Injectable()
export class ClientsService {
  constructor(
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    private readonly sites: SitesService,
  ) {}

  async create(input: ClientInput) {
    const fields = await this.normalizeInput(input, true);
    try {
      return await this.clientModel.create(fields);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Client ID already exists.');
      }
      throw error;
    }
  }

  async update(id: string, input: ClientInput) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid client id.');
    }
    const fields = await this.normalizeInput(input, false);
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('No changes provided.');
    }
    try {
      const updated = await this.clientModel.findByIdAndUpdate(id, fields, {
        new: true,
      });
      if (!updated) throw new NotFoundException('Client not found.');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Client ID already exists.');
      }
      throw error;
    }
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid client id.');
    }
    const deleted = await this.clientModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Client not found.');
    return { id: String(deleted._id) };
  }

  async findAll(query: ListClientsQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      const escaped = this.escapeRegExp(query.search.trim());
      filter.$or = [
        { name: new RegExp(escaped, 'i') },
        { clientId: new RegExp(escaped, 'i') },
      ];
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.clientModel.find(filter).sort({ name: 1 }).skip(skip).limit(query.limit).lean(),
      this.clientModel.countDocuments(filter),
    ]);
    const siteIds = items.flatMap((item) => item.siteIds ?? []);
    const siteMap = await this.sites.findSummariesByIds(siteIds);

    return {
      items: items.map((item) => ({
        ...item,
        id: String(item._id),
        sites: (item.siteIds ?? [])
          .map((siteId) => siteMap.get(siteId))
          .filter((site): site is NonNullable<typeof site> => Boolean(site)),
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async findForSite(siteCode: string) {
    const siteMap = await this.sites.findSummariesByCodes([siteCode]);
    const site = siteMap.get(siteCode.trim().toUpperCase());
    if (!site) return { items: [] };

    const items = await this.clientModel
      .find({ siteIds: site.id })
      .sort({ name: 1 })
      .lean();
    return {
      items: items.map((item) => ({
        id: String(item._id),
        name: item.name,
        clientId: item.clientId,
      })),
    };
  }

  private async normalizeInput(input: ClientInput, required: boolean) {
    const name = input.name?.trim();
    const clientId = input.clientId?.trim();
    const siteIds = input.siteIds;
    if (required && (!name || !clientId || !siteIds?.length)) {
      throw new BadRequestException('Client name, ID, and site are required.');
    }
    const fields: ClientInput = {};
    if (name !== undefined) {
      if (!name) throw new BadRequestException('Client name is required.');
      fields.name = name;
    }
    if (clientId !== undefined) {
      if (!clientId) throw new BadRequestException('Client ID is required.');
      fields.clientId = clientId;
    }
    if (siteIds !== undefined) {
      const normalized = Array.from(new Set(siteIds.map((site) => site.trim()))).filter(Boolean);
      if (!normalized.length) throw new BadRequestException('At least one site is required.');
      const siteMap = await this.sites.findSummariesByIds(normalized);
      if (siteMap.size !== normalized.length) {
        throw new BadRequestException('One or more selected sites do not exist.');
      }
      fields.siteIds = normalized;
    }
    return fields;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
