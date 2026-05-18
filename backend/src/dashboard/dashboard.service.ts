import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppRole } from '../auth/roles.constants';
import {
  MenuProduction,
  MenuProductionDocument,
} from '../menu-productions/schemas/menu-production.schema';
import { Recipe, RecipeDocument } from '../recipes/schemas/recipe.schema';
import { Site, SiteDocument } from '../sites/schemas/site.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(MenuProduction.name)
    private readonly menuProductionModel: Model<MenuProductionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Site.name)
    private readonly siteModel: Model<SiteDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
  ) {}

  async getSuperadminSummary() {
    const today = this.formatDateKey(new Date());

    const [
      activeSites,
      inactiveSites,
      activeUsers,
      unassignedUsers,
      menusToday,
      pendingApprovals,
      requestedStoreRequests,
      fulfilledStoreRequests,
      pendingRecipes,
    ] = await Promise.all([
      this.siteModel.countDocuments({ isActive: true }),
      this.siteModel.countDocuments({ isActive: false }),
      this.userModel.countDocuments({ isActive: true }),
      this.userModel.countDocuments({
        isActive: true,
        roles: { $nin: [AppRole.Superadmin] },
        $and: [
          { $or: [{ siteId: { $exists: false } }, { siteId: null }] },
          { $or: [{ sites: { $exists: false } }, { sites: { $size: 0 } }] },
        ],
      }),
      this.menuProductionModel.countDocuments({ productionDate: today }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        approvalStatus: 'pending',
      }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        approvalStatus: 'approved',
        storeRequestStatus: 'requested',
      }),
      this.menuProductionModel.countDocuments({
        productionDate: today,
        approvalStatus: 'approved',
        storeRequestStatus: 'fulfilled',
      }),
      this.recipeModel.countDocuments({
        approvalStatus: 'pending',
        deletedAt: { $exists: false },
      }),
    ]);

    return {
      summary: {
        activeSites,
        inactiveSites,
        activeUsers,
        unassignedUsers,
        menusToday,
        pendingApprovals,
        requestedStoreRequests,
        fulfilledStoreRequests,
        pendingRecipes,
      },
    };
  }

  // BACKEND LOGIC: chef dashboard summary values from menu productions.
  async getChefSummary(site?: string) {
    const today = this.formatDateKey(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = this.formatDateKey(yesterdayDate);
    const siteFilter = this.buildSiteFilter(site);
    const baseFilter = Object.keys(siteFilter).length > 0 ? siteFilter : {};

    const [
      menusToday,
      menusYesterday,
      approvedToday,
      pendingToday,
      storeRequestedToday,
      storeFulfilledToday,
      priorityItems,
    ] = await Promise.all([
      this.menuProductionModel.countDocuments({
        ...baseFilter,
        productionDate: today,
      }),
      this.menuProductionModel.countDocuments({
        ...baseFilter,
        productionDate: yesterday,
      }),
      this.menuProductionModel.countDocuments({
        ...baseFilter,
        productionDate: today,
        approvalStatus: 'approved',
      }),
      this.menuProductionModel.countDocuments({
        ...baseFilter,
        productionDate: today,
        approvalStatus: 'pending',
      }),
      this.menuProductionModel.countDocuments({
        ...baseFilter,
        productionDate: today,
        storeRequestStatus: 'requested',
      }),
      this.menuProductionModel.countDocuments({
        ...baseFilter,
        productionDate: today,
        storeRequestStatus: 'fulfilled',
      }),
      this.menuProductionModel
        .find({ ...baseFilter, productionDate: today })
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
      {
        label: 'Store requests pending',
        value: `${storeRequestedToday} menus`,
      },
      {
        label: 'Store requests fulfilled',
        value: `${storeFulfilledToday} menus`,
      },
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

  private buildSiteFilter(site?: string) {
    if (!site) return {};
    return { site };
  }
}
