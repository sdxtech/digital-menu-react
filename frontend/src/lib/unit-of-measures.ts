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
