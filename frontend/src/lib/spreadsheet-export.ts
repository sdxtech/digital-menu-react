type SpreadsheetDecimalCell = {
  kind: 'decimal'
  value: number
}

export type SpreadsheetCell =
  | string
  | number
  | Date
  | SpreadsheetDecimalCell
  | null
  | undefined

export type SpreadsheetSheet = {
  name: string
  rows: SpreadsheetCell[][]
}

const INTEGER_FORMAT = '#,##0'
const DECIMAL_FORMAT = '0.######'
const DATE_FORMAT = 'dd/mm/yyyy'

const sanitizeWorksheetName = (value: string) => {
  const cleaned = value.replace(/[\\/:*?[\]]/g, '-').trim() || 'Sheet'
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned
}

const getCellDisplayLength = (value: SpreadsheetCell) => {
  if (value instanceof Date) return DATE_FORMAT.length
  if (isSpreadsheetDecimalCell(value)) return String(value.value).length
  return value === null || value === undefined ? 0 : String(value).length
}

const parseSpreadsheetNumber = (value: unknown): number | '' => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : ''
  }
  if (typeof value !== 'string' || !value.trim()) return ''

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : ''
}

const isSpreadsheetDecimalCell = (
  value: SpreadsheetCell,
): value is SpreadsheetDecimalCell =>
  typeof value === 'object' &&
  value !== null &&
  !(value instanceof Date) &&
  value.kind === 'decimal'

export const toSpreadsheetInteger = (value: unknown): number | '' => {
  const parsed = parseSpreadsheetNumber(value)
  return parsed === '' ? '' : Math.trunc(parsed)
}

export const toSpreadsheetDecimal = (
  value: unknown,
): SpreadsheetDecimalCell | '' => {
  const parsed = parseSpreadsheetNumber(value)
  return parsed === '' ? '' : { kind: 'decimal', value: parsed }
}

export const toSpreadsheetDate = (value: unknown): Date | '' => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value
  }
  if (typeof value !== 'string' || !value.trim()) return ''

  const text = value.trim()
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1])
    const month = Number(dateOnlyMatch[2])
    const day = Number(dateOnlyMatch[3])
    const parsed = new Date(year, month - 1, day)
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed
    }
    return ''
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed
}

export const buildSpreadsheetBuffer = async (sheets: SpreadsheetSheet[]) => {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Digital Menu'
  workbook.created = new Date()

  sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(sanitizeWorksheetName(sheet.name))
    worksheet.addRows(
      sheet.rows.map((row) =>
        row.map((cell) => {
          if (isSpreadsheetDecimalCell(cell)) return cell.value
          return cell === null || cell === undefined ? '' : cell
        }),
      ),
    )

    const headerRow = worksheet.getRow(1)
    headerRow.font = { bold: true }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E1F2' },
    }
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const sourceCell = sheet.rows[rowNumber - 1]?.[columnNumber - 1]
        if (cell.value instanceof Date) {
          cell.numFmt = DATE_FORMAT
        } else if (isSpreadsheetDecimalCell(sourceCell)) {
          cell.numFmt = DECIMAL_FORMAT
        } else if (typeof cell.value === 'number') {
          cell.numFmt = INTEGER_FORMAT
        }
      })
    })

    const columnCount = Math.max(0, ...sheet.rows.map((row) => row.length))
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const maximumLength = Math.max(
        0,
        ...sheet.rows.map((row) =>
          getCellDisplayLength(row[columnIndex - 1]),
        ),
      )
      worksheet.getColumn(columnIndex).width = Math.min(
        36,
        Math.max(10, maximumLength + 2),
      )
    }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

export const downloadSpreadsheet = async (
  filename: string,
  sheets: SpreadsheetSheet[],
) => {
  const bytes = await buildSpreadsheetBuffer(sheets)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
