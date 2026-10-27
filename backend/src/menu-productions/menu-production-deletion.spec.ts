import { MenuProductionsService } from './menu-productions.service';

const firstId = '507f1f77bcf86cd799439011';
const secondId = '507f1f77bcf86cd799439012';
const ids = [firstId, secondId];
const input = {
  menuProductionIds: ids,
  reason: '  Duplicate MPR replaced by MPR0002  ',
};

const makeMenus = () =>
  ids.map((_id) => ({
    _id,
    productionCode: 'MPR0001',
    productionDate: '2026-10-27',
    clientName: 'Client A',
    site: 'S001',
    approvalStatus: 'approved',
    storeRequestStatus: 'requested',
    isDraft: false,
  }));

const makeService = (menus: Array<Record<string, unknown>> = makeMenus()) => {
  const model = {
    find: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(menus) }),
    countDocuments: jest.fn().mockResolvedValue(menus.length),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: menus.length }),
  };
  const service = new MenuProductionsService(
    model as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, model };
};

describe('Superadmin MPR deletion', () => {
  it.each([
    ['pending', 'not-requested'],
    ['approved', 'requested'],
    ['approved', 'fulfilled'],
    ['approved', 'cancelled'],
    ['rejected', 'not-requested'],
  ])(
    'deletes an entire %s / %s MPR with its recorded issuance details',
    async (approvalStatus, storeRequestStatus) => {
      const { service, model } = makeService(
        makeMenus().map((menu) => ({
          ...menu,
          approvalStatus,
          storeRequestStatus,
          storeFulfillmentItems: [{ productCode: 'IT001', actualQty: 10 }],
        })),
      );
      await expect(service.deleteBatch(input)).resolves.toEqual({
        productionCode: 'MPR0001',
        productionDate: '2026-10-27',
        site: 'S001',
        clientName: 'Client A',
        deletedCount: 2,
        reason: input.reason.trim(),
      });
      const batchFilter = {
        productionCode: 'MPR0001',
        productionDate: '2026-10-27',
        site: 'S001',
        isDraft: { $ne: true },
      };
      expect(model.countDocuments).toHaveBeenCalledWith(batchFilter);
      expect(model.deleteMany).toHaveBeenCalledWith({
        ...batchFilter,
        _id: { $in: ids },
      });
    },
  );

  it('applies site scope before looking up the selected batch', async () => {
    const { service, model } = makeService();
    await service.deleteBatch(input, 'S001');
    expect(model.find).toHaveBeenCalledWith({
      _id: { $in: ids },
      site: 'S001',
    });
  });

  it.each([
    { menuProductionIds: [], reason: 'Duplicate MPR' },
    { menuProductionIds: ['invalid-id'], reason: 'Duplicate MPR' },
    { menuProductionIds: ids, reason: '   ' },
    { menuProductionIds: ids, reason: 'x'.repeat(1001) },
  ])(
    'rejects invalid ids or a missing audit reason before reading data',
    async (invalid) => {
      const { service, model } = makeService();
      await expect(service.deleteBatch(invalid)).rejects.toThrow();
      expect(model.find).not.toHaveBeenCalled();
      expect(model.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('rejects stale or inaccessible menu ids without deleting any menu', async () => {
    const { service, model } = makeService(makeMenus().slice(0, 1));
    await expect(service.deleteBatch(input)).rejects.toThrow('not found');
    expect(model.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['productionCode', 'productionDate', 'site'])(
    'rejects selections spanning different %s values even for the same client',
    async (field) => {
      const menus = makeMenus().map((menu, index) =>
        index ? { ...menu, [field]: 'another-batch' } : menu,
      );
      const { service, model } = makeService(menus);
      await expect(service.deleteBatch(input)).rejects.toThrow(
        'same MPR batch',
      );
      expect(model.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('rejects a partial batch selection instead of deleting only some menus', async () => {
    const { service, model } = makeService(makeMenus().slice(0, 1));
    model.countDocuments.mockResolvedValue(2);
    await expect(
      service.deleteBatch({ ...input, menuProductionIds: [firstId] }),
    ).rejects.toThrow('MPR has changed');
    expect(model.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a batch whose menu count changed after the list was loaded', async () => {
    const { service, model } = makeService();
    model.countDocuments.mockResolvedValue(3);
    await expect(service.deleteBatch(input)).rejects.toThrow('MPR has changed');
    expect(model.deleteMany).not.toHaveBeenCalled();
  });

  it('does not delete production drafts through the records action', async () => {
    const { service, model } = makeService(
      makeMenus().map((menu) => ({ ...menu, isDraft: true })),
    );
    await expect(service.deleteBatch(input)).rejects.toThrow(
      'Only submitted MPRs',
    );
    expect(model.deleteMany).not.toHaveBeenCalled();
  });

  it('handles a legacy batch without a code or site using only its selected id', async () => {
    const { service, model } = makeService([
      { ...makeMenus()[0], productionCode: undefined, site: undefined },
    ]);
    await service.deleteBatch({ ...input, menuProductionIds: [firstId] });
    expect(model.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [firstId] },
      productionDate: '2026-10-27',
      site: { $in: [null, ''] },
      isDraft: { $ne: true },
    });
  });

  it('reports when another action has already removed the batch', async () => {
    const { service, model } = makeService();
    model.deleteMany.mockResolvedValue({ deletedCount: 0 });
    await expect(service.deleteBatch(input)).rejects.toThrow('already deleted');
  });
});
