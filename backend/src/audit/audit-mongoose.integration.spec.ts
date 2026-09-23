import { Logger } from '@nestjs/common';
import { Mongoose, Schema, Types } from 'mongoose';
import { CategorySchema } from '../categories/schemas/category.schema';
import { ClientSchema } from '../clients/schemas/client.schema';
import { FeatureFlagSchema } from '../feature-flags/schemas/feature-flag.schema';
import { MenuGroupSchema } from '../menu-groups/schemas/menu-group.schema';
import { MenuProductionSchema } from '../menu-productions/schemas/menu-production.schema';
import { NotificationSchema } from '../notifications/schemas/notification.schema';
import { ProductSchema } from '../products/schemas/product.schema';
import { RawMaterialSchema } from '../raw-materials/schemas/raw-material.schema';
import { RawMaterialVendorPriceSchema } from '../raw-materials/schemas/raw-material-vendor-price.schema';
import { RecipeSchema } from '../recipes/schemas/recipe.schema';
import { SiteSchema } from '../sites/schemas/site.schema';
import { UnitConversionSchema } from '../unit-of-measures/schemas/unit-conversion.schema';
import { UnitOfMeasureSchema } from '../unit-of-measures/schemas/unit-of-measure.schema';
import { UserSchema } from '../users/schemas/user.schema';
import { RecipeCodeCounterSchema } from '../recipes/schemas/recipe-code-counter.schema';
import { AuditLogSchema } from './schemas/audit-log.schema';
import { AuditArchiveSchema } from './schemas/audit-archive.schema';
import { AuditRequestContext, auditRequestStorage } from './audit-context';
import { auditMongoosePlugin } from './audit-mongoose.plugin';

// Real schema validation, casting and middleware; only MongoDB I/O is stubbed.
const fixtures: Array<{
  name: string;
  schema: Schema;
  input: Record<string, unknown>;
}> = [
  { name: 'Category', schema: CategorySchema, input: { name: 'Main' } },
  {
    name: 'Client',
    schema: ClientSchema,
    input: { name: 'Client', clientId: 'C001', siteIds: ['S001'] },
  },
  {
    name: 'FeatureFlag',
    schema: FeatureFlagSchema,
    input: { key: 'maintenance', enabled: false },
  },
  { name: 'MenuGroup', schema: MenuGroupSchema, input: { name: 'Lunch' } },
  {
    name: 'MenuProduction',
    schema: MenuProductionSchema,
    input: {
      menuName: 'Lunch',
      category: 'Main',
      portion: 10,
      cost: 100,
      productionDate: '2026-09-23',
      sellingPricePerPax: 20,
      sellingQuantity: 10,
      ingredientVendors: [
        { productCode: 'IT001', vendor: 'Vendor', price: 10 },
      ],
      storeFulfillmentItems: [{ productCode: 'IT001', actualQty: 2 }],
    },
  },
  {
    name: 'Notification',
    schema: NotificationSchema,
    input: {
      title: 'Approval',
      message: 'Pending',
      meta: { recipeId: new Types.ObjectId() },
    },
  },
  {
    name: 'Product',
    schema: ProductSchema,
    input: { name: 'Product', price: 10, categoryId: new Types.ObjectId() },
  },
  {
    name: 'RawMaterial',
    schema: RawMaterialSchema,
    input: {
      productCode: 'IT001',
      productCodeNormalized: 'it001',
      name: 'Material',
      unitOfMeasures: 'KG',
      specificConversions: [
        { prodUomCode: 'KG', srUomCode: 'GR', conversionFactor: 1000 },
      ],
      extraFields: { source: 'Import' },
    },
  },
  {
    name: 'RawMaterialVendorPrice',
    schema: RawMaterialVendorPriceSchema,
    input: {
      productCode: 'IT001',
      productCodeNormalized: 'it001',
      name: 'Material',
      unitOfMeasures: 'KG',
      unitOfMeasuresNormalized: 'kg',
      site: 'S001',
      siteNormalized: 's001',
      vendor: 'Vendor',
      vendorNormalized: 'vendor',
      extraFields: { source: 'Import' },
    },
  },
  {
    name: 'Recipe',
    schema: RecipeSchema,
    input: {
      name: 'Recipe',
      ingredients: [{ name: 'Material', qty: 1 }],
      approvalHistory: [{ rejectionReason: 'Review', rejectedAt: new Date() }],
    },
  },
  { name: 'Site', schema: SiteSchema, input: { name: 'Site', code: 'S001' } },
  {
    name: 'UnitConversion',
    schema: UnitConversionSchema,
    input: {
      prodUomCode: 'KG',
      srUomCode: 'GR',
      conversionId: 'KG-GR',
      multiplier: 1000,
      ext: 1,
      weight: 1,
    },
  },
  {
    name: 'UnitOfMeasure',
    schema: UnitOfMeasureSchema,
    input: { name: 'Kilogram', code: 'KG' },
  },
  {
    name: 'User',
    schema: UserSchema,
    input: {
      name: 'User',
      email: 'user@example.com',
      passwordHash: 'test-hash',
      roles: ['chef'],
      siteId: new Types.ObjectId(),
    },
  },
];

const setup = (name: string, schema: Schema) => {
  const connection = new Mongoose().createConnection();
  connection.plugin(auditMongoosePlugin);
  const model = connection.model<
    Record<string, unknown> & { _id: Types.ObjectId }
  >(name, schema.clone());
  return { connection, model };
};

describe('audit middleware across application schemas', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(fixtures)(
    'creates and saves $name without breaking nested data',
    async ({ name, schema, input }) => {
      const { connection, model } = setup(name, schema);
      const insert = jest
        .spyOn(model.collection, 'insertOne')
        .mockResolvedValue({
          acknowledged: true,
          insertedId: new Types.ObjectId(),
        });
      const update = jest
        .spyOn(model.collection, 'updateOne')
        .mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });
      const context: AuditRequestContext = { databaseChanges: [] };
      try {
        const doc = await auditRequestStorage.run(context, () =>
          model.create(input),
        );
        expect(insert).toHaveBeenCalledTimes(1);
        expect(context.databaseChanges).toHaveLength(1);
        expect(context.databaseChanges[0].operation).toBe('create');
        expect(context.databaseChanges[0].after).toHaveProperty(
          '_id',
          doc._id.toString(),
        );
        jest
          .spyOn(model.collection, 'findOne')
          .mockResolvedValue(doc.toObject());
        const field = Object.keys(input)[0];
        doc.set(field, `Updated ${String(input[field])}`);
        await auditRequestStorage.run(context, () => doc.save());
        expect(update).toHaveBeenCalledTimes(1);
        expect(context.databaseChanges).toHaveLength(2);
        expect(context.databaseChanges[1].operation).toBe('save');
        expect(context.databaseChanges[1].changes[field]).toBeDefined();
        if (name === 'User')
          expect(context.databaseChanges[0].after).toHaveProperty(
            'passwordHash',
            '[REDACTED]',
          );
        if (name.startsWith('RawMaterial'))
          expect(context.databaseChanges[0].after).toHaveProperty(
            'extraFields.source',
            'Import',
          );
      } finally {
        await connection.close();
      }
    },
  );

  it.each(
    (
      [
        'findOneAndUpdate',
        'updateOne',
        'updateMany',
        'replaceOne',
        'findOneAndDelete',
        'deleteOne',
        'deleteMany',
      ] as const
    ).flatMap((operation) =>
      [false, true].map((snapshotFailure) => ({ operation, snapshotFailure })),
    ),
  )(
    'preserves $operation results (snapshot failure: $snapshotFailure)',
    async ({ operation, snapshotFailure }) => {
      const { connection, model } = setup(
        'MenuProduction',
        MenuProductionSchema,
      );
      const id = new Types.ObjectId();
      const result = {
        _id: id,
        menuName: 'Lunch',
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        deletedCount: 1,
      };
      const write = jest
        .spyOn(model.collection, operation)
        .mockResolvedValue(result as never);
      const read = jest
        .spyOn(model.collection, 'find')
        .mockImplementation(() => {
          if (snapshotFailure) throw new Error('Snapshot read failed');
          return {
            toArray: () => Promise.resolve([{ _id: id, menuName: 'Lunch' }]),
          } as never;
        });
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const context: AuditRequestContext = { databaseChanges: [] };
      try {
        await expect(
          auditRequestStorage.run(context, async () => {
            switch (operation) {
              case 'findOneAndUpdate':
                return model
                  .findOneAndUpdate(
                    { _id: id },
                    { $set: { sellingPricePerPax: 20 } },
                    { returnDocument: 'after' },
                  )
                  .lean();
              case 'updateOne':
                return model.updateOne(
                  { _id: id },
                  { $set: { sellingQuantity: 10 } },
                );
              case 'updateMany':
                return model.updateMany(
                  { site: 'S001' },
                  { $set: { approvalStatus: 'approved' } },
                );
              case 'replaceOne':
                return model.replaceOne(
                  { _id: id },
                  {
                    menuName: 'Lunch',
                    category: 'Main',
                    portion: 10,
                    cost: 100,
                    productionDate: '2026-09-23',
                  },
                );
              case 'findOneAndDelete':
                return model.findOneAndDelete({ _id: id }).lean();
              case 'deleteOne':
                return model.deleteOne({ _id: id });
              case 'deleteMany':
                return model.deleteMany({ site: 'S001' });
            }
          }),
        ).resolves.toEqual(result);
        expect(write).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalled();
        if (snapshotFailure) expect(logger).toHaveBeenCalled();
        else {
          expect(logger).not.toHaveBeenCalled();
          expect(context.databaseChanges).toHaveLength(1);
          expect(context.databaseChanges[0].before).toEqual({
            _id: id.toHexString(),
            menuName: 'Lunch',
          });
          expect(context.databaseChanges[0].after).toEqual(
            operation.toLowerCase().includes('delete')
              ? null
              : { _id: id.toHexString(), menuName: 'Lunch' },
          );
        }
      } finally {
        await connection.close();
      }
    },
  );

  it('preserves database write errors without fabricating a successful audit entry', async () => {
    const { connection, model } = setup('Site', SiteSchema);
    const error = Object.assign(new Error('Duplicate key'), { code: 11000 });
    jest.spyOn(model.collection, 'insertOne').mockRejectedValue(error);
    const context: AuditRequestContext = { databaseChanges: [] };
    try {
      await expect(
        auditRequestStorage.run(context, () =>
          model.create({ name: 'Site', code: 'S001' }),
        ),
      ).rejects.toBe(error);
      expect(context.databaseChanges).toEqual([]);
    } finally {
      await connection.close();
    }
  });

  it.each([
    {
      name: 'RecipeCodeCounter',
      schema: RecipeCodeCounterSchema,
      input: { key: 'recipe_code', seq: 1 },
    },
    {
      name: 'AuditLog',
      schema: AuditLogSchema,
      input: {
        module: 'recipes',
        action: 'POST',
        method: 'POST',
        path: '/recipes',
        success: true,
        statusCode: 201,
      },
    },
    {
      name: 'AuditArchive',
      schema: AuditArchiveSchema,
      input: { year: 2025, status: 'processing' },
    },
  ])('does not recursively audit $name', async ({ name, schema, input }) => {
    const { connection, model } = setup(name, schema);
    jest.spyOn(model.collection, 'insertOne').mockResolvedValue({
      acknowledged: true,
      insertedId: new Types.ObjectId(),
    });
    const context: AuditRequestContext = { databaseChanges: [] };
    try {
      await auditRequestStorage.run(context, () => model.create(input));
      expect(context.databaseChanges).toEqual([]);
    } finally {
      await connection.close();
    }
  });

  it('preserves document saves when pre-save snapshot reading fails', async () => {
    const { connection, model } = setup('User', UserSchema);
    const doc = model.hydrate({
      _id: new Types.ObjectId(),
      name: 'User',
      email: 'user@example.com',
      roles: ['chef'],
      passwordHash: 'test-hash',
    });
    doc.set('name', 'Updated');
    jest
      .spyOn(model.collection, 'findOne')
      .mockRejectedValue(new Error('Snapshot unavailable'));
    const update = jest.spyOn(model.collection, 'updateOne').mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    });
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        auditRequestStorage.run({ databaseChanges: [] }, () => doc.save()),
      ).resolves.toBe(doc);
      expect(update).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it('preserves document saves when post-save serialization fails', async () => {
    const { connection, model } = setup('Site', SiteSchema);
    const doc = new model({ name: 'Site', code: 'S001' });
    const insert = jest
      .spyOn(model.collection, 'insertOne')
      .mockResolvedValue({ acknowledged: true, insertedId: doc._id });
    // toObject is used by Mongoose for the write first, then by audit after it.
    const toObject = doc.toObject.bind(doc) as () => Record<string, unknown>;
    jest.spyOn(doc, 'toObject').mockImplementation(() => {
      if (insert.mock.calls.length)
        throw new Error('Audit serialization failed');
      return toObject();
    });
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        auditRequestStorage.run({ databaseChanges: [] }, () => doc.save()),
      ).resolves.toBe(doc);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it('leaves reads and mutations outside audit request context unchanged', async () => {
    const { connection, model } = setup('Site', SiteSchema);
    const read = jest
      .spyOn(model.collection, 'find')
      .mockReturnValue({ toArray: () => Promise.resolve([]) } as never);
    jest.spyOn(model.collection, 'updateOne').mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    });
    try {
      await model.updateOne({ code: 'S001' }, { $set: { name: 'Updated' } });
      expect(read).not.toHaveBeenCalled();
      await auditRequestStorage.run({ databaseChanges: [] }, () =>
        model.find().lean(),
      );
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      await connection.close();
    }
  });

  it('does not block recipe imports or bulk price writes', async () => {
    const { connection, model } = setup('Recipe', RecipeSchema);
    jest.spyOn(model.collection, 'insertMany').mockResolvedValue({
      acknowledged: true,
      insertedCount: 1,
      insertedIds: { 0: new Types.ObjectId() },
    });
    const result = { ok: 1, modifiedCount: 1 };
    jest
      .spyOn(model.collection, 'bulkWrite')
      .mockResolvedValue(result as never);
    try {
      const context: AuditRequestContext = { databaseChanges: [] };
      const docs = await auditRequestStorage.run(context, () =>
        model.insertMany([
          { name: 'Imported', ingredients: [{ name: 'Material', qty: 1 }] },
        ]),
      );
      expect(docs).toHaveLength(1);
      await expect(
        auditRequestStorage.run(context, () =>
          model.bulkWrite([
            {
              updateOne: {
                filter: { _id: docs[0]._id },
                update: { $set: { price: 100 } },
              },
            },
          ]),
        ),
      ).resolves.toBe(result);
      // These operations currently rely on the HTTP audit entry, not save/query hooks.
      expect(context.databaseChanges).toEqual([]);
    } finally {
      await connection.close();
    }
  });
});
