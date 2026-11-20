import { BadRequestException } from '@nestjs/common';
import type { RawMaterial } from '../raw-materials/schemas/raw-material.schema';
import type { InventoryLine } from './inventory.schema';

export const inventoryCode = (value: string) => value.trim().toUpperCase();
export const roundInventory = (value: number) => Math.round(value * 1e6) / 1e6;

// Specific material factors map SR quantities to production quantities in the
// existing production-quantity resolver; global multipliers map production to SR.
export function inventoryQuantity(
  quantity: number,
  fromUnit: string,
  targetUnit: string,
  material: Partial<
    Pick<
      RawMaterial,
      | 'unitOfMeasures'
      | 'baseUnitOfMeasures'
      | 'conversionFactor'
      | 'specificConversions'
    >
  >,
  globalMultiplier?: number,
) {
  const from = inventoryCode(fromUnit);
  const target = inventoryCode(targetUnit);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1e12) {
    throw new BadRequestException(
      'Inventory quantity must be a finite non-negative number.',
    );
  }
  if (from === target) return roundInventory(quantity);
  const rules = [...(material.specificConversions ?? [])];
  const legacyProd = inventoryCode(material.baseUnitOfMeasures ?? '');
  const legacySr = inventoryCode(material.unitOfMeasures ?? '');
  if (
    legacyProd &&
    !rules.some(
      (rule) =>
        inventoryCode(rule.prodUomCode) === legacyProd &&
        inventoryCode(rule.srUomCode) === legacySr,
    )
  ) {
    rules.push({
      prodUomCode: legacyProd,
      srUomCode: legacySr,
      conversionFactor: material.conversionFactor ?? 0,
    });
  }
  const factors = new Set<number>();
  for (const rule of rules) {
    if (!Number.isFinite(rule.conversionFactor) || rule.conversionFactor <= 0)
      continue;
    const prod = inventoryCode(rule.prodUomCode);
    const sr = inventoryCode(rule.srUomCode);
    if (prod === from && sr === target) factors.add(1 / rule.conversionFactor);
    if (sr === from && prod === target) factors.add(rule.conversionFactor);
  }
  if (
    !factors.size &&
    globalMultiplier &&
    Number.isFinite(globalMultiplier) &&
    globalMultiplier > 0
  ) {
    factors.add(globalMultiplier);
  }
  if (factors.size !== 1) {
    throw new BadRequestException(
      `Cannot unambiguously convert ${from} to inventory unit ${target}.`,
    );
  }
  const converted = roundInventory(quantity * Array.from(factors)[0]);
  if (!Number.isFinite(converted) || converted > 1e12) {
    throw new BadRequestException('Converted inventory quantity is too large.');
  }
  return converted;
}

export function inventoryDelta(
  previous: InventoryLine[],
  next: InventoryLine[],
): InventoryLine[] {
  const deltas = new Map<string, InventoryLine>();
  for (const [lines, sign] of [
    [previous, 1],
    [next, -1],
  ] as const) {
    for (const line of lines) {
      const key = `${inventoryCode(line.productCode)}::${inventoryCode(line.unitOfMeasures)}`;
      const existing = deltas.get(key);
      deltas.set(key, {
        ...line,
        quantity: roundInventory(
          (existing?.quantity ?? 0) + sign * line.quantity,
        ),
      });
    }
  }
  return [...deltas.values()].filter((line) => line.quantity !== 0);
}
