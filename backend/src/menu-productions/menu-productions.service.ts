import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';
import {
  ApprovalStatus,
  MenuProduction,
  MenuProductionDocument,
  StoreRequestStatus,
} from './schemas/menu-production.schema';

@Injectable()
export class MenuProductionsService {
  constructor(
    @InjectModel(MenuProduction.name)
    private readonly menuProductionModel: Model<MenuProductionDocument>,
  ) {}

  async create(input: CreateMenuProductionDto, createdBy?: string) {
    return this.menuProductionModel.create({
      menuName: input.menuName.trim(),
      category: input.category.trim(),
      portion: input.portion,
      productionDate: input.productionDate,
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      createdBy,
    });
  }

  async createMany(inputs: CreateMenuProductionDto[], createdBy?: string) {
    if (!inputs.length) return [];
    const payload = inputs.map((input) => ({
      menuName: input.menuName.trim(),
      category: input.category.trim(),
      portion: input.portion,
      productionDate: input.productionDate,
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      createdBy,
    }));
    return this.menuProductionModel.insertMany(payload, { ordered: false });
  }

  async findAll(query: ListMenuProductionsQueryDto) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { menuName: new RegExp(this.escapeRegExp(text), 'i') },
        { category: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.storeRequestStatus) filter.storeRequestStatus = query.storeRequestStatus;
    if (query.productionDate) filter.productionDate = query.productionDate;

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.menuProductionModel
        .find(filter)
        .sort({ productionDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.menuProductionModel.countDocuments(filter),
    ]);

    const needsSync = items.some(
      (item) =>
        item.approvalStatus === 'approved' &&
        item.storeRequestStatus === 'not-requested',
    );
    if (needsSync) {
      await this.menuProductionModel.updateMany(
        { approvalStatus: 'approved', storeRequestStatus: 'not-requested' },
        { $set: { storeRequestStatus: 'requested' } },
      );
      items.forEach((item) => {
        if (
          item.approvalStatus === 'approved' &&
          item.storeRequestStatus === 'not-requested'
        ) {
          item.storeRequestStatus = 'requested';
        }
      });
    }

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async setApprovalStatus(id: string, status: ApprovalStatus) {
    const nextStoreStatus: StoreRequestStatus =
      status === 'approved' ? 'requested' : 'not-requested';
    const updated = await this.menuProductionModel
      .findByIdAndUpdate(
        id,
        { approvalStatus: status, storeRequestStatus: nextStoreStatus },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Menu production not found');
    return updated;
  }

  async setStoreRequestStatus(id: string, status: StoreRequestStatus) {
    const item = await this.menuProductionModel.findById(id);
    if (!item) throw new NotFoundException('Menu production not found');
    if (status === 'requested') {
      if (item.approvalStatus !== 'approved') {
        throw new BadRequestException('Menu production is not approved yet.');
      }
    }
    if (status === 'fulfilled') {
      if (item.approvalStatus !== 'approved') {
        throw new BadRequestException('Menu production is not approved yet.');
      }
      if (item.storeRequestStatus !== 'requested') {
        throw new BadRequestException('Store request has not been submitted yet.');
      }
    }
    item.storeRequestStatus = status;
    return item.save();
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
