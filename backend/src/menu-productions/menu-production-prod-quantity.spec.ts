import { MenuProductionsService } from './menu-productions.service';
import { resolveProductionQuantity } from './production-quantity';

describe('MPR production quantities', () => {
  it.each([false, true])(
    'merges incomplete production data without partial totals (reverse=%s)',
    async (reverse) => {
      const service = new MenuProductionsService(
        {} as never,
        {} as never,
        { find: () => ({ lean: () => Promise.resolve([]) }) } as never,
        {} as never,
        {} as never,
        {} as never,
        {
          findLookupsByNormalizedCodes: jest.fn().mockResolvedValue([]),
        } as never,
      );
      const base = {
        productCode: 'IT00793_N',
        name: 'Lettuce',
        unitOfMeasures: 'KG',
        qty: 1,
      };
      const ingredients = [
        base,
        { ...base, qty: 0.2, prodQty: 200, prodUomCode: 'GR' },
      ];
      if (reverse) ingredients.reverse();
      const groups = await service['buildGroupedStoreRequestsFromMenus']([
        {
          portion: 90,
          recipeSnapshot: { portionSize: 10, ingredients },
        },
      ]);
      expect(groups[0].summary).toHaveLength(1);
      expect(groups[0].summary[0]).toMatchObject({
        qty: 10.8,
        prodQty: undefined,
        prodUomCode: undefined,
      });
      expect(
        groups[0].items[0].ingredients.find((row) => row.prodQty != null),
      ).toMatchObject({ prodQty: 1800, prodUomCode: 'GR' });
    },
  );

  it('fills legacy quantities in one batch and merges matching units without changing snapshots', async () => {
    const lookup = jest.fn().mockResolvedValue([
      {
        productCode: 'IT00790_N',
        unitOfMeasures: 'KG',
        specificConversions: [
          { prodUomCode: 'GR', srUomCode: 'KG', conversionFactor: 1000 },
        ],
      },
    ]);
    const service = new MenuProductionsService(
      {} as never,
      {} as never,
      { find: () => ({ lean: () => Promise.resolve([]) }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { findLookupsByNormalizedCodes: lookup } as never,
    );
    const ingredient = {
      productCode: 'IT00790_N',
      name: 'Lettuce',
      qty: 1,
      unitOfMeasures: 'KG',
    };
    const menus = [
      {
        portion: 60,
        productionDate: '2026-11-16',
        productionCode: 'MPR1',
        recipeSnapshot: { portionSize: 10, ingredients: [ingredient] },
      },
      {
        portion: 12,
        productionDate: '2026-11-16',
        productionCode: 'MPR1',
        recipeSnapshot: {
          portionSize: 10,
          ingredients: [{ ...ingredient, prodQty: 1000, prodUomCode: 'GR' }],
        },
      },
    ];
    const original = JSON.stringify(menus);
    const groups = await service['buildGroupedStoreRequestsFromMenus'](menus);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(['it00790_n']);
    expect(groups[0].summary).toHaveLength(1);
    expect(groups[0].summary[0]).toMatchObject({
      qty: 7.2,
      prodQty: 7200,
      prodUomCode: 'GR',
    });
    expect(groups[0].items[0].ingredients[0].prodQty).toBe(6000);
    expect(JSON.stringify(menus)).toBe(original);
  });

  it('uses stored conversion first and avoids lookups for complete or convertible snapshots', async () => {
    const lookup = jest.fn();
    const service = new MenuProductionsService(
      {} as never,
      {} as never,
      { find: () => ({ lean: () => Promise.resolve([]) }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { findLookupsByNormalizedCodes: lookup } as never,
    );
    const groups = await service['buildGroupedStoreRequestsFromMenus']([
      {
        portion: 20,
        recipeSnapshot: {
          portionSize: 10,
          ingredients: [
            {
              productCode: 'IT001',
              qty: 2,
              unitOfMeasures: 'KG',
              conversionId: 'GR To KG',
              conversionMultiplier: 0.001,
            },
          ],
        },
      },
    ]);
    expect(groups[0].items[0].ingredients[0]).toMatchObject({
      prodQty: 4000,
      prodUomCode: 'GR',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('scales snapshot production quantities by base portion and leaves legacy values absent', async () => {
    const service = new MenuProductionsService(
      {} as never,
      {} as never,
      { find: () => ({ lean: () => Promise.resolve([]) }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findLookupsByNormalizedCodes: jest.fn().mockResolvedValue([]),
      } as never,
    );
    const groups = await service['buildGroupedStoreRequestsFromMenus']([
      {
        portion: 25,
        productionDate: '2026-11-16',
        recipeSnapshot: {
          portionSize: 10,
          ingredients: [
            {
              productCode: 'IT001',
              name: 'Rice',
              qty: 2,
              unitOfMeasures: 'KG',
              prodQty: 2000,
              prodUomCode: 'GR',
            },
            {
              productCode: 'IT002',
              name: 'Salt',
              qty: 0.1,
              unitOfMeasures: 'KG',
            },
            {
              productCode: 'IT003',
              name: 'Water',
              qty: 0,
              unitOfMeasures: 'L',
              prodQty: 0,
              prodUomCode: 'ML',
            },
          ],
        },
      },
    ]);
    expect(groups[0].items[0].ingredients).toEqual([
      expect.objectContaining({ qty: 5, prodQty: 5000, prodUomCode: 'GR' }),
      expect.objectContaining({
        qty: 0.25,
        prodQty: undefined,
        prodUomCode: undefined,
      }),
      expect.objectContaining({ qty: 0, prodQty: 0, prodUomCode: 'ML' }),
    ]);
  });
});

describe('legacy conversion resolution', () => {
  const ingredient = { qty: 2, unitOfMeasures: 'KG' };
  const material = {
    unitOfMeasures: 'KG',
    specificConversions: [
      { prodUomCode: 'GR', srUomCode: 'KG', conversionFactor: 1000 },
      { prodUomCode: 'ML', srUomCode: 'KG', conversionFactor: 1200 },
    ],
  };

  it('leaves ambiguous or missing conversions unresolved and honors a known target', () => {
    expect(
      resolveProductionQuantity(ingredient, 3, material).prodQty,
    ).toBeUndefined();
    expect(resolveProductionQuantity(ingredient, 3).prodQty).toBeUndefined();
    expect(
      resolveProductionQuantity(
        { ...ingredient, prodUomCode: 'gr' },
        3,
        material,
      ),
    ).toEqual({ prodQty: 6000, prodUomCode: 'GR' });
  });

  it('handles packaging factors, zero, invalid factors and conflicting stored units', () => {
    const packaging = {
      unitOfMeasures: 'BAG_20',
      baseUnitOfMeasures: 'GR',
      conversionFactor: 20000,
      specificConversions: [],
    };
    expect(
      resolveProductionQuantity(
        { qty: 0.3, unitOfMeasures: 'BAG_20' },
        2,
        packaging,
      ),
    ).toEqual({ prodQty: 12000, prodUomCode: 'GR' });
    expect(
      resolveProductionQuantity(
        { qty: 0, unitOfMeasures: 'BAG_20' },
        2,
        packaging,
      ).prodQty,
    ).toBe(0);
    expect(
      resolveProductionQuantity(ingredient, 2, {
        ...packaging,
        unitOfMeasures: 'KG',
        conversionFactor: -1,
      }).prodQty,
    ).toBeUndefined();
    expect(
      resolveProductionQuantity(
        { ...ingredient, conversionId: 'GR To L', conversionMultiplier: 0.001 },
        2,
      ).prodQty,
    ).toBeUndefined();
    expect(
      resolveProductionQuantity(
        { ...ingredient, prodQty: 0, prodUomCode: 'GR' },
        2,
        material,
      ),
    ).toEqual({ prodQty: 0, prodUomCode: 'GR' });
  });
});
