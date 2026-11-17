import type { RecipeIngredient } from '../recipes/schemas/recipe.schema';
import type { RawMaterial } from '../raw-materials/schemas/raw-material.schema';

type ProductionQuantity = { prodQty?: number; prodUomCode?: string };
type MaterialConversion = Partial<
  Pick<
    RawMaterial,
    | 'unitOfMeasures'
    | 'baseUnitOfMeasures'
    | 'conversionFactor'
    | 'specificConversions'
  >
>;

const unit = (value?: string) => value?.trim().toUpperCase() || undefined;
const finite = (value?: number): value is number =>
  value != null && Number.isFinite(value);

// multiplier converts recipe-base quantities to the requested portions.
export function resolveProductionQuantity(
  ingredient: RecipeIngredient,
  multiplier: number,
  material?: MaterialConversion,
): ProductionQuantity {
  const prodUomCode = unit(ingredient.prodUomCode);
  if (finite(ingredient.prodQty) && prodUomCode) {
    const prodQty = ingredient.prodQty * multiplier;
    return { prodQty: finite(prodQty) ? prodQty : undefined, prodUomCode };
  }

  const unresolved = { prodUomCode };
  const sr = unit(ingredient.unitOfMeasures);
  if (!sr || !finite(ingredient.qty) || !finite(multiplier)) return unresolved;
  const srQty = ingredient.qty * multiplier;
  if (!finite(srQty)) return unresolved;
  if (prodUomCode === sr) return { prodQty: srQty, prodUomCode };

  const [storedProd, storedSr, extra] = (ingredient.conversionId ?? '')
    .split(/\s+to\s+/i)
    .map(unit);
  if (
    !ingredient.srQtyManual &&
    storedProd &&
    storedSr === sr &&
    !extra &&
    (!prodUomCode || prodUomCode === storedProd) &&
    finite(ingredient.conversionMultiplier) &&
    ingredient.conversionMultiplier > 0
  ) {
    const prodQty = srQty / ingredient.conversionMultiplier;
    if (finite(prodQty)) return { prodQty, prodUomCode: storedProd };
  }

  if (!material) return unresolved;
  const rules = [...(material.specificConversions ?? [])];
  const legacyProd = unit(material.baseUnitOfMeasures);
  const legacySr = unit(material.unitOfMeasures);
  // Explicit rules take precedence over legacy fields for the same pair.
  if (
    legacyProd &&
    legacySr &&
    !rules.some(
      (rule) =>
        unit(rule.prodUomCode) === legacyProd &&
        unit(rule.srUomCode) === legacySr,
    )
  ) {
    rules.push({
      prodUomCode: legacyProd,
      srUomCode: legacySr,
      conversionFactor: material.conversionFactor ?? 0,
    });
  }
  const candidates = new Map<string, { prodUomCode: string; factor: number }>();
  for (const rule of rules) {
    const target = unit(rule.prodUomCode);
    if (
      !target ||
      unit(rule.srUomCode) !== sr ||
      (prodUomCode && prodUomCode !== target) ||
      !finite(rule.conversionFactor) ||
      rule.conversionFactor <= 0
    )
      continue;
    candidates.set(`${target}:${rule.conversionFactor}`, {
      prodUomCode: target,
      factor: rule.conversionFactor,
    });
  }
  if (candidates.size !== 1) return unresolved;
  const conversion = Array.from(candidates.values())[0];
  if (!conversion) return unresolved;
  const prodQty = srQty * conversion.factor;
  return finite(prodQty)
    ? { prodQty, prodUomCode: conversion.prodUomCode }
    : unresolved;
}
