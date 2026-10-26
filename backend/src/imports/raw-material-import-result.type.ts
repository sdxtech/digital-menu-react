export type RawMaterialImportResult = {
  status: 'completed' | 'cancelled';
  successCount: number;
  failCount: number;
  errors: Array<{ row: number; name?: string; reason: string }>;
};
