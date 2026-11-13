import { Fragment } from 'react'
import { formatCreatedDate, formatProductionDate } from '../lib/date-format'
import { getFinanceBatchStatus } from '../lib/production-batch-status'
import { getApprovalStatusLabel, type ApprovalStatusLabelValue } from '../lib/status-labels'

type ProductionInformationProps = {
  financeItems: Array<{
    approvalStatus: ApprovalStatusLabelValue
    financeApprovalRequired?: boolean
    financeCostStatus?: ApprovalStatusLabelValue
    financeSalesStatus?: ApprovalStatusLabelValue
    financeCostReviewedBy?: string
    financeSalesReviewedBy?: string
  }>
  productionCode?: string
  createdAt?: string
  submittedBy?: string
  admin?: string
  reviewedBy?: string
  storekeeper?: string
  batchStatus: string
  productionDate: string
  client?: string
  totalMenu: number
  approvalStatus: string
  storeRequestStatus: string
}

const ProductionInformation = ({
  financeItems,
  productionCode,
  createdAt,
  submittedBy,
  admin,
  reviewedBy,
  storekeeper,
  batchStatus,
  productionDate,
  client,
  totalMenu,
  approvalStatus,
  storeRequestStatus,
}: ProductionInformationProps) => {
  const requiredFinanceItems = financeItems.filter((item) => item.financeApprovalRequired === true)
  const financeApprovers = Array.from(new Set(requiredFinanceItems.flatMap((item) => [
    item.financeCostStatus === 'approved' ? item.financeCostReviewedBy?.trim() : undefined,
    item.financeSalesStatus === 'approved' ? item.financeSalesReviewedBy?.trim() : undefined,
  ]).filter((name): name is string => Boolean(name)))).join(', ')
  const financeStatus = getFinanceBatchStatus(financeItems)
  const fields: Array<[string, string | number | undefined]> = [
    ['Production code', productionCode], ['Batch status', batchStatus],
    ['Created date', formatCreatedDate(createdAt)], ['Production date', formatProductionDate(productionDate)],
    ['Submitted by', submittedBy], ['Client', client],
    ['Admin', admin], ['Total menu', totalMenu],
    ['Reviewed by', reviewedBy], ['Approval status', approvalStatus],
    ['Storekeeper', storekeeper], ['Store request status', storeRequestStatus],
  ]

  if (requiredFinanceItems.length > 0) {
    fields.splice(10, 0,
      ['Finance Ops. Control', financeApprovers],
      ['Finance Approval Status', financeStatus ? getApprovalStatusLabel(financeStatus) : '-'],
    )
  }

  return (
    <section className="border-b border-border pb-4">
      <h3 className="text-sm font-bold text-black">Production information</h3>
      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] border-l border-t border-black text-sm md:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
        {fields.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="border-b border-r border-black bg-primary px-3 py-2 font-bold uppercase text-white">
              {label}
            </dt>
            <dd className="min-w-0 break-words whitespace-normal border-b border-r border-black bg-white px-3 py-2 font-bold text-black">
              {typeof value === 'string' ? value.trim() || '-' : value ?? '-'}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  )
}

export default ProductionInformation
