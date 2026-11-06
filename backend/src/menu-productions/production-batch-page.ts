import type { PipelineStage, Types } from 'mongoose';
import type { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';

export type ProductionBatchPage = {
  items: {
    _id: { site: string; date: string; code: string };
    ids: Types.ObjectId[];
  }[];
  total: { count: number }[];
  clients: { _id: string }[];
};

// Select complete batches before loading menus, recipes, costs, or fulfillment details.
export function productionBatchPagePipeline(
  filter: Record<string, unknown>,
  query: ListMenuProductionsQueryDto,
  drafts = false,
): PipelineStage[] {
  const trim = (field: string) => ({
    $trim: { input: { $ifNull: [`$${field}`, ''] } },
  });
  const code = trim('productionCode');
  const recordsView = query.view === 'records' || query.view === 'records-all';
  const matches: Record<string, unknown>[] = [];
  if (query.approvalStatus)
    matches.push({ approvalStatuses: query.approvalStatus });
  if (query.view === 'sales')
    matches.push({ $or: [{ salesComplete: 0 }, { returnedSales: 1 }] });
  if (query.view === 'finance-approval')
    matches.push({ financePending: 1, salesReady: 1 });
  if (query.view === 'approval')
    matches.push({ financeBlocked: 0, salesReady: 1 });
  if (query.view === 'records')
    matches.push({
      $or: [
        { storeStatuses: { $in: ['fulfilled', 'cancelled'] } },
        { approvalStatuses: 'rejected' },
        { approvedRequested: 1 },
      ],
    });
  if (query.view === 'records-all')
    matches.push({
      $or: [
        { storeStatuses: { $in: ['fulfilled', 'cancelled'] } },
        { approvalStatuses: { $in: ['pending', 'rejected'] } },
        { approvedRequested: 1 },
      ],
    });
  const selection: Record<string, unknown> = {};
  if (query.startDate || query.endDate || query.productionDate)
    selection['_id.date'] = query.productionDate ?? {
      ...(query.startDate ? { $gte: query.startDate } : {}),
      ...(query.endDate ? { $lte: query.endDate } : {}),
    };
  if (query.clientName?.trim())
    selection.normalizedClients = query.clientName.trim().toLowerCase();
  if (query.createdFrom || query.createdBefore)
    selection.createdAt = {
      ...(query.createdFrom ? { $gte: new Date(query.createdFrom) } : {}),
      ...(query.createdBefore ? { $lt: new Date(query.createdBefore) } : {}),
    };
  const sort: Record<string, 1 | -1> = drafts
    ? { updatedAt: -1, '_id.code': 1, '_id.site': 1, '_id.date': 1 }
    : {
        [query.dateSort?.startsWith('created') ? 'createdAt' : '_id.date']:
          query.dateSort?.endsWith('desc') ? -1 : 1,
        '_id.code': 1,
        '_id.site': 1,
      };
  if (query.dateSort?.startsWith('created')) sort['_id.date'] = 1;
  return [
    { $match: filter },
    {
      $group: {
        _id: {
          site: trim('site'),
          date: trim('productionDate'),
          code: { $cond: [{ $ne: [code, ''] }, code, { $toString: '$_id' }] },
        },
        ...(query.summaryOnly ? {} : { ids: { $push: '$_id' } }),
        createdAt: { $max: { $ifNull: ['$submittedAt', '$createdAt'] } },
        ...(drafts ? { updatedAt: { $max: '$updatedAt' } } : {}),
        clients: { $addToSet: trim('clientName') },
        ...(query.view === 'finance-approval'
          ? {
              financePending: {
                $max: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ['$financeCostStatus', 'pending'] },
                        { $eq: ['$financeSalesStatus', 'pending'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            }
          : {}),
        ...(query.view === 'approval' || query.view === 'finance-approval'
          ? {
              salesReady: {
                $min: {
                  $cond: [
                    {
                      $and: [
                        { $isNumber: '$sellingPricePerPax' },
                        { $isNumber: '$sellingQuantity' },
                        { $eq: [trim('salesRejectionReason'), ''] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            }
          : {}),
        ...(query.view === 'approval'
          ? {
              financeBlocked: {
                $max: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$financeApprovalRequired', true] },
                        {
                          $or: [
                            { $ne: ['$financeCostStatus', 'approved'] },
                            { $ne: ['$financeSalesStatus', 'approved'] },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            }
          : {}),
        ...(query.clientName?.trim()
          ? {
              normalizedClients: {
                $addToSet: { $toLower: trim('clientName') },
              },
            }
          : {}),
        ...(query.approvalStatus || recordsView
          ? {
              approvalStatuses: {
                $addToSet: { $ifNull: ['$approvalStatus', 'pending'] },
              },
            }
          : {}),
        ...(recordsView
          ? {
              storeStatuses: {
                $addToSet: {
                  $ifNull: ['$storeRequestStatus', 'not-requested'],
                },
              },
              approvedRequested: {
                $max: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$approvalStatus', 'approved'] },
                        { $eq: ['$storeRequestStatus', 'requested'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            }
          : {}),
        ...(query.view === 'sales'
          ? {
              returnedSales: {
                $max: {
                  $cond: [{ $ne: [trim('salesRejectionReason'), ''] }, 1, 0],
                },
              },
              salesComplete: {
                $min: {
                  $cond: [
                    {
                      $and: [
                        {
                          $or: [
                            { $isNumber: '$sellingPricePerPax' },
                            { $eq: [{ $type: '$sellingPricePerPax' }, 'null'] },
                          ],
                        },
                        {
                          $or: [
                            { $isNumber: '$sellingQuantity' },
                            { $eq: [{ $type: '$sellingQuantity' }, 'null'] },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            }
          : {}),
      },
    },
    ...(matches.length ? [{ $match: { $and: matches } } as PipelineStage] : []),
    {
      $facet: {
        items: query.summaryOnly
          ? [{ $limit: 1 }, { $project: { _id: 1 } }]
          : [
              { $match: selection },
              { $sort: sort },
              ...(query.page || query.limit
                ? [
                    { $skip: ((query.page ?? 1) - 1) * (query.limit ?? 10) },
                    { $limit: query.limit ?? 10 },
                  ]
                : []),
              { $project: { ids: 1 } },
            ],
        total: [{ $match: selection }, { $count: 'count' }],
        clients: [
          { $unwind: '$clients' },
          { $match: { clients: { $ne: '' } } },
          {
            $group: {
              _id: { $toLower: '$clients' },
              name: { $first: '$clients' },
            },
          },
          { $project: { _id: '$name' } },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];
}
