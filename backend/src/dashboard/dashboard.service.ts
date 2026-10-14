import { BadRequestException, Injectable } from '@nestjs/common';
import { MenuProductionsService } from '../menu-productions/menu-productions.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
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

type AnalyticsValues = {
  pax: number | null;
  estimatedCost: number | null;
  estimatedRevenue: number | null;
};

type AnalyticsRow = AnalyticsValues & {
  key: string;
  date: string;
  site: string;
  client: string;
  productionCode: string;
  sellingPricePerPax: number | null;
  foodCostPercentage: number | null;
};

const foodCostPercentage = (values: AnalyticsValues) =>
  values.estimatedCost !== null &&
  values.estimatedRevenue !== null &&
  values.estimatedRevenue > 0
    ? (values.estimatedCost / values.estimatedRevenue) * 100
    : null;

const totalAnalyticsRows = (rows: AnalyticsValues[]) => {
  const sum = (field: keyof AnalyticsValues) =>
    rows.some((row) => row[field] === null)
      ? null
      : rows.reduce((total, row) => total + (row[field] ?? 0), 0);
  const values = {
    pax: sum('pax'),
    estimatedCost: sum('estimatedCost'),
    estimatedRevenue: sum('estimatedRevenue'),
  };
  return { ...values, foodCostPercentage: foodCostPercentage(values) };
};

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
    private readonly menuProductions: MenuProductionsService,
  ) {}

  async getSuperadminAnalytics(query: AnalyticsQueryDto) {
    const parseDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('Dates must use YYYY-MM-DD.');
      }
      const date = new Date(`${value}T00:00:00.000Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      ) {
        throw new BadRequestException('Invalid production date.');
      }
      return date;
    };
    const start = parseDate(query.startDate);
    const end = parseDate(query.endDate);
    const days = (end.getTime() - start.getTime()) / 86400000;
    if (days < 0 || days > 365) {
      throw new BadRequestException(
        'Select a date range of up to 366 days in chronological order.',
      );
    }
    const interval = query.interval ?? 'daily';
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const [groups, sites] = await Promise.all([
      this.menuProductions.buildAnalyticsProductionGroups(
        query.startDate,
        query.endDate,
        query.site?.trim(),
        query.clientId?.trim(),
      ),
      this.siteModel
        .find()
        .select({ code: 1, name: 1 })
        .sort({ code: 1 })
        .lean(),
    ]);
    const workflow = {
      totalBatches: groups.length,
      approval: { pendingSales: 0, submitted: 0, approved: 0, returned: 0 },
      storeRequest: {
        notRequested: 0,
        requested: 0,
        fulfilled: 0,
        cancelled: 0,
        mixed: 0,
      },
    };
    const rows: AnalyticsRow[] = [];
    const numberOrNull = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : null;
    for (const group of groups) {
      const items = group.items;
      if (!items.length) continue;
      const approved = items.every(
        (item) => item.approvalStatus === 'approved',
      );
      const salesComplete = items.every(
        (item) =>
          numberOrNull(item.sellingPricePerPax) !== null &&
          numberOrNull(item.sellingQuantity) !== null,
      );
      if (approved) workflow.approval.approved++;
      else if (items.some((item) => item.approvalStatus === 'rejected'))
        workflow.approval.returned++;
      else if (salesComplete) workflow.approval.submitted++;
      else workflow.approval.pendingSales++;
      const statuses = new Set(items.map((item) => item.storeRequestStatus));
      if (statuses.size > 1) workflow.storeRequest.mixed++;
      else {
        const status = items[0].storeRequestStatus;
        if (status === 'requested') workflow.storeRequest.requested++;
        else if (status === 'fulfilled') workflow.storeRequest.fulfilled++;
        else if (status === 'cancelled') workflow.storeRequest.cancelled++;
        else workflow.storeRequest.notRequested++;
      }
      if (!approved) continue;
      const first = items[0];
      // Sales values belong to the batch and are duplicated on its menus.
      const pax = numberOrNull(first.sellingQuantity);
      const sellingPricePerPax = numberOrNull(first.sellingPricePerPax);
      const consistentSales =
        salesComplete &&
        items.every(
          (item) =>
            item.sellingQuantity === pax &&
            item.sellingPricePerPax === sellingPricePerPax,
        );
      const values: AnalyticsValues = {
        pax: consistentSales ? pax : null,
        estimatedCost: items.some(
          (item) => numberOrNull(item.estimatedCost) === null,
        )
          ? null
          : items.reduce((total, item) => total + (item.estimatedCost ?? 0), 0),
        estimatedRevenue:
          consistentSales && pax !== null && sellingPricePerPax !== null
            ? sellingPricePerPax * pax
            : null,
      };
      rows.push({
        ...values,
        key: `${group.site ?? ''}__${group.date}__${group.productionCode ?? first.id}`,
        date: group.date,
        site: group.site ?? '',
        client: [
          ...new Set(items.map((item) => item.clientName).filter(Boolean)),
        ].join(', '),
        productionCode: group.productionCode ?? first.id,
        sellingPricePerPax: consistentSales ? sellingPricePerPax : null,
        foodCostPercentage: foodCostPercentage(values),
      });
    }
    const periodKey = (dateKey: string) => {
      if (interval === 'monthly') return dateKey.slice(0, 7);
      if (interval === 'weekly') {
        const date = new Date(`${dateKey}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        return date.toISOString().slice(0, 10);
      }
      return dateKey;
    };
    const periods = new Map<string, AnalyticsRow[]>();
    for (let day = 0; day <= days; day++) {
      const date = new Date(start.getTime() + day * 86400000)
        .toISOString()
        .slice(0, 10);
      periods.set(periodKey(date), []);
    }
    const siteRows = new Map<string, AnalyticsRow[]>();
    for (const row of rows) {
      periods.get(periodKey(row.date))?.push(row);
      const current = siteRows.get(row.site) ?? [];
      current.push(row);
      siteRows.set(row.site, current);
    }
    const siteOptions = new Map(
      sites.map((site) => [site.code, { code: site.code, name: site.name }]),
    );
    for (const group of groups) {
      if (group.site && !siteOptions.has(group.site)) {
        siteOptions.set(group.site, { code: group.site, name: group.site });
      }
    }
    return {
      summary: {
        ...totalAnalyticsRows(rows),
        approvedBatches: rows.length,
        incompleteBatches: rows.filter(
          (row) =>
            row.pax === null ||
            row.estimatedCost === null ||
            row.estimatedRevenue === null,
        ).length,
      },
      workflow,
      trend: [...periods].map(([period, periodRows]) => ({
        period,
        batches: periodRows.length,
        ...totalAnalyticsRows(periodRows),
      })),
      bySite: [...siteRows]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([site, items]) => ({
          site,
          batches: items.length,
          ...totalAnalyticsRows(items),
        })),
      sites: [...siteOptions.values()]
        .filter((site) => site.code)
        .sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true }),
        ),
      items: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
    };
  }

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
