export const unitOfMeasuresOptions = [
  { value: 'kg', label: 'Kg' },
  { value: 'gram', label: 'Gram' },
  { value: 'liter', label: 'Liter' },
  { value: 'ml', label: 'mL' },
  { value: 'gal', label: 'Gal' },
  { value: 'pack', label: 'Pack' },
  { value: 'bag', label: 'Bag' },
  { value: 'pcs', label: 'Pcs' },
  { value: 'ctn', label: 'Ctn' },
  { value: 'sachet', label: 'Sachet' },
  { value: 'jar', label: 'Jar' },
  { value: 'botol', label: 'Bottle' },
]

export const formatUnitLabel = (value: string) =>
  unitOfMeasuresOptions.find((option) => option.value === value)?.label ?? value

export const formatConversionFactor = (value?: number) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return ''
  return Number.isInteger(value) ? String(value) : String(value)
}

export const formatRawMaterialConversion = (
  srUom: string,
  baseUom?: string,
  conversionFactor?: number,
) => {
  const factor = formatConversionFactor(conversionFactor)
  if (!srUom || !baseUom || !factor) return '-'
  return `1 ${formatUnitLabel(srUom)} = ${factor} ${formatUnitLabel(baseUom)}`
}
