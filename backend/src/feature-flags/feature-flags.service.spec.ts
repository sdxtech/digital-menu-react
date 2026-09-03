import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  const createService = (featureFlagModel: Record<string, jest.Mock>) =>
    new FeatureFlagsService(featureFlagModel as never);

  it('enables Inventory by default when no setting exists', async () => {
    const lean = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ lean });
    const service = createService({ findOne });

    await expect(service.getInventory()).resolves.toEqual({
      key: 'inventory',
      enabled: true,
    });
    expect(findOne).toHaveBeenCalledWith({ key: 'inventory' });
  });

  it('persists the Inventory status with an upsert', async () => {
    const lean = jest
      .fn()
      .mockResolvedValue({ key: 'inventory', enabled: false });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const service = createService({ findOneAndUpdate });

    await expect(service.setInventory(false)).resolves.toEqual({
      key: 'inventory',
      enabled: false,
    });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'inventory' },
      { $set: { enabled: false } },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
  });
});
