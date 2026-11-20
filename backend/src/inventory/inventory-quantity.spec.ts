import { inventoryDelta, inventoryQuantity } from './inventory-quantity';

const line = { productCode: 'IT001', name: 'Rice', unitOfMeasures: 'KG' };

describe('Inventory quantities', () => {
  it('uses SR quantities directly with six-decimal precision', () => {
    expect(inventoryQuantity(1.23456789, ' kg ', 'KG', {})).toBe(1.234568);
  });

  it('converts using material-specific rules before global multipliers', () => {
    const material = {
      specificConversions: [
        { prodUomCode: 'G', srUomCode: 'KG', conversionFactor: 1000 },
      ],
    };
    expect(inventoryQuantity(500, 'G', 'KG', material, 99)).toBe(0.5);
    expect(inventoryQuantity(0.5, 'KG', 'G', material)).toBe(500);
  });

  it('uses legacy material factors and global conversion fallback', () => {
    expect(
      inventoryQuantity(500, 'G', 'KG', {
        unitOfMeasures: 'KG',
        baseUnitOfMeasures: 'G',
        conversionFactor: 1000,
      }),
    ).toBe(0.5);
    expect(inventoryQuantity(500, 'G', 'KG', {}, 0.001)).toBe(0.5);
  });

  it('rejects missing or ambiguous conversions and invalid quantities', () => {
    expect(() => inventoryQuantity(1, 'BOX', 'KG', {})).toThrow(
      'Cannot unambiguously convert',
    );
    expect(() =>
      inventoryQuantity(1, 'G', 'KG', {
        specificConversions: [
          { prodUomCode: 'G', srUomCode: 'KG', conversionFactor: 1000 },
          { prodUomCode: 'G', srUomCode: 'KG', conversionFactor: 500 },
        ],
      }),
    ).toThrow('Cannot unambiguously convert');
    for (const quantity of [-1, Infinity, NaN, 1e13])
      expect(() => inventoryQuantity(quantity, 'KG', 'KG', {})).toThrow();
  });

  it('deducts actual quantities once and records only correction differences', () => {
    expect(inventoryDelta([], [{ ...line, quantity: 3 }])).toEqual([
      { ...line, quantity: -3 },
    ]);
    expect(
      inventoryDelta([{ ...line, quantity: 3 }], [{ ...line, quantity: 5 }]),
    ).toEqual([{ ...line, quantity: -2 }]);
    expect(inventoryDelta([{ ...line, quantity: 5 }], [])).toEqual([
      { ...line, quantity: 5 },
    ]);
    expect(
      inventoryDelta([{ ...line, quantity: 3 }], [{ ...line, quantity: 3 }]),
    ).toEqual([]);
  });
});
