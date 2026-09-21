import { AsyncLocalStorage } from 'node:async_hooks';

export type AuditDatabaseChange = {
  collection: string;
  operation: string;
  before: unknown;
  after: unknown;
  changes: Record<string, { before: unknown; after: unknown }>;
  truncated?: boolean;
};

export type AuditRequestContext = {
  databaseChanges: AuditDatabaseChange[];
};

export const auditRequestStorage = new AsyncLocalStorage<AuditRequestContext>();

export const hasAuditRequestContext = () =>
  Boolean(auditRequestStorage.getStore());

export const addAuditDatabaseChange = (change: AuditDatabaseChange) => {
  const context = auditRequestStorage.getStore();
  if (context && context.databaseChanges.length < 100) {
    context.databaseChanges.push(change);
  }
};
