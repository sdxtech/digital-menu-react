import type { Schema } from 'mongoose';
import {
  addAuditDatabaseChange,
  hasAuditRequestContext,
} from './audit-context';
import { buildAuditDiff, sanitizeAuditValue } from './audit-sanitizer';

type AuditQuery = {
  model: {
    collection: { name: string };
    find(filter: unknown): {
      limit(value: number): { lean(): Promise<unknown[]> };
    };
  };
  op: string;
  getFilter(): unknown;
  $auditBefore?: unknown[];
  $auditTruncated?: boolean;
};

const ignoredCollections = new Set(['auditlogs', 'auditarchives', 'counters']);
const queryOperations = [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

export const auditMongoosePlugin = (schema: Schema) => {
  for (const operation of queryOperations) {
    schema.pre(operation, async function () {
      if (!hasAuditRequestContext()) return;
      const query = this as unknown as AuditQuery;
      if (ignoredCollections.has(query.model.collection.name)) return;
      const rows = await query.model.find(query.getFilter()).limit(21).lean();
      query.$auditTruncated = rows.length > 20;
      query.$auditBefore = rows.slice(0, 20).map(sanitizeAuditValue);
    });

    schema.post(operation, async function () {
      if (!hasAuditRequestContext()) return;
      const query = this as unknown as AuditQuery;
      if (ignoredCollections.has(query.model.collection.name)) return;
      const before = query.$auditBefore ?? [];
      const isDelete = query.op.toLowerCase().includes('delete');
      let after: unknown[] = [];
      if (!isDelete) {
        const beforeIds = before
          .map((item) =>
            item && typeof item === 'object'
              ? (item as Record<string, unknown>)._id
              : undefined,
          )
          .filter(Boolean);
        const filter = beforeIds.length
          ? { _id: { $in: beforeIds } }
          : query.getFilter();
        const rows = await query.model.find(filter).limit(21).lean();
        after = rows.slice(0, 20).map(sanitizeAuditValue);
      }
      const beforeSnapshot = before.length <= 1 ? (before[0] ?? null) : before;
      const afterSnapshot = after.length <= 1 ? (after[0] ?? null) : after;
      addAuditDatabaseChange({
        collection: query.model.collection.name,
        operation: query.op,
        before: beforeSnapshot,
        after: afterSnapshot,
        changes: buildAuditDiff(beforeSnapshot, afterSnapshot),
        ...(query.$auditTruncated ? { truncated: true } : {}),
      });
    });
  }

  schema.pre('save', async function () {
    if (!hasAuditRequestContext()) return;
    const document = this as unknown as {
      isNew: boolean;
      constructor: {
        collection: { name: string };
        findById(id: unknown): { lean(): Promise<unknown> };
      };
      _id: unknown;
      $locals: Record<string, unknown>;
    };
    if (ignoredCollections.has(document.constructor.collection.name)) return;
    document.$locals.auditBefore = document.isNew
      ? null
      : sanitizeAuditValue(
          await document.constructor.findById(document._id).lean(),
        );
  });

  schema.post('save', function () {
    if (!hasAuditRequestContext()) return;
    const document = this as unknown as {
      constructor: { collection: { name: string } };
      $locals: Record<string, unknown>;
      toObject(): unknown;
    };
    if (ignoredCollections.has(document.constructor.collection.name)) return;
    const before = document.$locals.auditBefore ?? null;
    const after = sanitizeAuditValue(document.toObject());
    addAuditDatabaseChange({
      collection: document.constructor.collection.name,
      operation: before ? 'save' : 'create',
      before,
      after,
      changes: buildAuditDiff(before, after),
    });
  });
};
