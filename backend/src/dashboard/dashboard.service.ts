import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MenuProduction,
  MenuProductionDocument,
} from '../menu-productions/schemas/menu-production.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(MenuProduction.name)
    private readonly menuProductionModel: Model<MenuProductionDocument>,
  ) {}

  // BACKEND LOGIC: chef dashboard summary values from menu productions.
  async getChefSummary() {
    const today = this.formatDateKey(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = this.formatDateKey(yesterdayDate);

    const [
      menusToday,
      menusYesterday,
      approvedToday,
      pendingToday,
      storeRequestedToday,
      storeFulfilledToday,
      priorityItems,
    ] = await Promise.all([
      this.menuProductionModel.countDocuments({ productionDate: today }),
      this.menuProductionModel.countDocuments({ productionDate: yesterday }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        approvalStatus: 'approved',
      }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        approvalStatus: 'pending',
      }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        storeRequestStatus: 'requested',
      }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        storeRequestStatus: 'fulfilled',
      }),
      this.menuProductionModel
        .find({ productionDate: today })
        .sort({ portion: -1, createdAt: 1 })
        .limit(4)
        .lean(),
    ]);

    const summary = {
      menusToday,
      menusTodayDelta: this.percentDelta(menusToday, menusYesterday),
      approvedToday,
      pendingToday,
      storeRequestedToday,
      storeFulfilledToday,
    };

    const priority = priorityItems.map((item) => ({
      name: item.menuName,
      status: this.approvalLabel(item.approvalStatus),
      value: `Pax ${item.portion}`,
    }));

    const progress = [
      { label: 'Pending approvals', value: `${pendingToday} menus` },
      { label: 'Approved menus', value: `${approvedToday} menus` },
      { label: 'Store requests pending', value: `${storeRequestedToday} menus` },
      { label: 'Store requests fulfilled', value: `${storeFulfilledToday} menus` },
    ];

    return { summary, priority, progress };
  }

  private formatDateKey(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private percentDelta(current: number, previous: number) {
    if (previous === 0) return current === 0 ? 0 : 100;
    return Math.round(((current - previous) / previous) * 100);
  }

  private approvalLabel(status: MenuProductionDocument['approvalStatus']) {
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Rejected';
    return 'Pending approval';
  }
}
