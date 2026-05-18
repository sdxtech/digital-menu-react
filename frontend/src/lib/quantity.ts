export const QUANTITY_DECIMAL_PLACES = 6

export const roundQuantity = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(QUANTITY_DECIMAL_PLACES))
}

export const formatQuantity = (value: number, fallback = '0') => {
  if (!Number.isFinite(value)) return fallback
  return String(roundQuantity(value))
}

export const formatSignedQuantity = (value: number) => {
  const roundedValue = roundQuantity(value)
  const formatted = formatQuantity(Math.abs(roundedValue))
  if (roundedValue > 0) return `+${formatted}`
  if (roundedValue < 0) return `-${formatted}`
  return '0'
}

export const quantitiesDiffer = (left: number, right: number) =>
  roundQuantity(left) !== roundQuantity(right)
