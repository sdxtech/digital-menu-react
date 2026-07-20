export type RawMaterialPriceUpdateInput = {
  productCode: string;
  price: number;
  rowNumber?: number;
  name?: string;
  site?: string;
  vendor?: string;
  currency?: string;
  unitOfMeasures?: string;
  minimumQuantity?: number;
  priceQuantity?: number;
};

export type RawMaterialPriceUpdateMode = 'master' | 'vendor' | 'mixed';
