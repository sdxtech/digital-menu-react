export type RawMaterialImportJobStatus = {
  jobId: string
  status:
    | 'waiting'
    | 'waiting-children'
    | 'active'
    | 'delayed'
    | 'prioritized'
    | 'completed'
    | 'failed'
    | 'cancelled'
  result: {
    status: 'completed' | 'cancelled'
    successCount: number
    failCount: number
    errors: Array<{ row: number; name?: string; reason: string }>
  } | null
}

export type RawMaterialImportResult = {
  status: 'success' | 'error' | 'cancelled'
  title: string
  message: string
}

export const getRawMaterialImportResult = (
  job: RawMaterialImportJobStatus,
): RawMaterialImportResult | null => {
  if (job.status === 'completed') {
    return {
      status: 'success',
      title: 'Raw material import completed',
      message: job.result
        ? `Raw material import finished. Success: ${job.result.successCount}, failed: ${job.result.failCount}.`
        : 'Raw material import completed. Detailed results are unavailable for this import.',
    }
  }
  if (job.status === 'cancelled') {
    return {
      status: 'cancelled',
      title: 'Raw material import cancelled',
      message: job.result
        ? `Raw material import was cancelled. Success before cancellation: ${job.result.successCount}, failed: ${job.result.failCount}.`
        : 'The import job was cancelled before it completed.',
    }
  }
  if (job.status === 'failed') {
    return {
      status: 'error',
      title: 'Raw material import failed',
      message: 'An error occurred while processing the raw material import file.',
    }
  }
  return null
}
