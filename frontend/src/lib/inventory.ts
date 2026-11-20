export type InventoryItem = {
  productCode: string
  name: string
  unitOfMeasures: string
}

export type InventoryLine = InventoryItem & { quantity: number }
export type InventoryStockLine = InventoryLine & { quantities: Record<string, number> }
export type InventoryStatus = { active: boolean; activatedAt: string | null }
export type InventoryEntry = {
  _id: string
  kind: 'opening' | 'receipt' | 'receipt-reversal' | 'issue'
  occurredAt: string
  createdAt: string
  actor: string
  supplier?: string
  reference?: string
  note?: string
  reversedAt?: string
  lines: InventoryLine[]
}
export type InventoryMovement = Omit<InventoryEntry, 'lines'> & InventoryLine & {
  lineIndex: number
  poNumber?: string
  productionCode?: string
}

export const inventoryTransactionType = ({ kind, quantity }: Pick<InventoryMovement, 'kind' | 'quantity'>) =>
  kind === 'opening' ? 'OPENING BALANCE' : quantity < 0 ? 'STOCK OUT' : 'STOCK IN'

export type InventoryPreview = {
  previewId?: string
  valid: boolean
  rows: Array<{
    row: number
    productCode: string
    name?: string
    unitOfMeasures: string
    quantity: number | null
    error?: string
  }>
}

export const inventoryLabels: Record<InventoryEntry['kind'], string> = {
  opening: 'Opening balance',
  receipt: 'Goods received',
  'receipt-reversal': 'Receipt reversal',
  issue: 'Store Request / correction',
}

export const inventoryDate = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'medium',
  })

export const inventoryQuantityLabel = (quantity: number) =>
  quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })
