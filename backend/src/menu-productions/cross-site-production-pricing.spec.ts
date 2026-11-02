import { MenuProductionsService } from './menu-productions.service';

describe('Cross-site production prices', () => {
  const recipe = {
    id: 'recipe',
    name: 'Soup',
    category: 'Main',
    version: 1,
    portionSize: 1,
    ingredients: [
      {
        ingredientType: 'IT' as const,
        productCode: 'IT002_N',
        name: 'Shared product',
        unitOfMeasures: 'KG',
        qty: 2,
        priceUom: 99999,
      },
    ],
  };
  const input = {
    recipeId: 'recipe',
    portion: 10,
    productionDate: '2026-11-02',
    cost: 0,
  };
  const setup = (options: object[] = []) => {
    const rawMaterials = {
      findVendorPrices: jest.fn().mockResolvedValue(options),
    };
    const model = { updateMany: jest.fn(), bulkWrite: jest.fn() };
    const service = new MenuProductionsService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      rawMaterials as never,
    );
    return { service, rawMaterials, model };
  };

  it('accepts a positive manual price without a vendor and freezes its calculated cost', async () => {
    const { service, rawMaterials, model } = setup();
    const resolved = await service['resolveProductionPrices'](
      { ...input, ingredientVendors: [{ ingredientIndex: 0, price: 15000 }] },
      recipe,
      'SOKIT',
    );
    const snapshot = service['calculateMenuProductionCostSnapshot'](
      resolved,
      recipe,
    );
    expect(snapshot).toMatchObject({
      estimatedTotalCost: 300000,
      estimatedCostPerPax: 30000,
      ingredientVendors: [
        { vendor: undefined, price: 15000, ingredientCost: 300000 },
      ],
    });
    expect(rawMaterials.findVendorPrices).toHaveBeenCalledWith({
      productCode: 'IT002_N',
      site: 'SOKIT',
      ownSiteOnly: true,
    });
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(model.bulkWrite).not.toHaveBeenCalled();
  });

  it.each([undefined, 0])(
    'requires a manual price when no site price exists (%s)',
    async (price) => {
      const { service } = setup();
      await expect(
        service['resolveProductionPrices'](
          { ...input, ingredientVendors: [{ ingredientIndex: 0, price }] },
          recipe,
          'SOKIT',
        ),
      ).rejects.toThrow('Enter a price greater than 0');
    },
  );

  it('lets incomplete drafts keep zero but blocks submitting them', async () => {
    const { service } = setup();
    const resolved = await service['resolveProductionPrices'](
      { ...input, saveAsDraft: true },
      recipe,
      'SOKIT',
    );
    expect(resolved.ingredientVendors?.[0]).toMatchObject({
      price: 0,
      vendor: undefined,
    });
    expect(() =>
      service['calculateMenuProductionCostSnapshot'](
        { ...resolved, saveAsDraft: false },
        recipe,
      ),
    ).toThrow('Enter a price greater than 0');
  });

  it('uses the current local price when it becomes available, including a blank vendor', async () => {
    const { service } = setup([
      { vendor: '', unitOfMeasures: 'KG', price: 20000 },
    ]);
    const resolved = await service['resolveProductionPrices'](
      {
        ...input,
        saveAsDraft: true,
        ingredientVendors: [{ ingredientIndex: 0, price: 15000 }],
      },
      recipe,
      'SOKIT',
    );
    expect(resolved.ingredientVendors?.[0]).toMatchObject({
      price: 20000,
      vendor: undefined,
      site: 'SOKIT',
    });
    expect(
      service['calculateMenuProductionCostSnapshot'](resolved, recipe)
        .estimatedTotalCost,
    ).toBe(400000);
  });

  it('does not treat a price in another unit as a local price', async () => {
    const { service } = setup([
      { vendor: 'Vendor', unitOfMeasures: 'BOX', price: 20000 },
    ]);
    const resolved = await service['resolveProductionPrices'](
      { ...input, ingredientVendors: [{ ingredientIndex: 0, price: 15000 }] },
      recipe,
      'SOKIT',
    );
    expect(resolved.ingredientVendors?.[0]).toMatchObject({
      price: 15000,
      vendor: undefined,
    });
  });
});
