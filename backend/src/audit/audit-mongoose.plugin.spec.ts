import { Logger } from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import { Recipe, RecipeSchema } from '../recipes/schemas/recipe.schema';
import { auditRequestStorage } from './audit-context';
import { auditMongoosePlugin } from './audit-mongoose.plugin';

type Hook = (this: unknown) => void | Promise<void>;

const setupPlugin = () => {
  const preHooks = new Map<string, Hook>();
  const postHooks = new Map<string, Hook>();
  const schema = {
    pre: jest.fn((operation: string, hook: Hook) => {
      preHooks.set(operation, hook);
    }),
    post: jest.fn((operation: string, hook: Hook) => {
      postHooks.set(operation, hook);
    }),
  };
  auditMongoosePlugin(schema as never);
  return { preHooks, postHooks };
};

const queryResult = (rows: unknown[] | Error) => ({
  limit: () => ({
    lean: () =>
      rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  }),
});

describe('audit mongoose plugin', () => {
  it('saves recipe ingredients and captures them in the parent audit snapshot', async () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    connection.plugin(auditMongoosePlugin);
    const model = connection.model(Recipe.name, RecipeSchema.clone());
    const insert = jest.spyOn(model.collection, 'insertOne').mockResolvedValue({
      acknowledged: true,
      insertedId: new Types.ObjectId(),
    });
    const recipe = new model({
      name: 'Test',
      category: 'Appetizer',
      site: 'S002',
      portionSize: 10,
      ingredients: [
        { ingredientType: 'IT', productCode: 'IT09679_N', qty: 0.2 },
      ],
    });
    const context = { databaseChanges: [] };

    await auditRequestStorage.run(context, () => recipe.save());

    expect(insert).toHaveBeenCalledTimes(1);
    expect(context.databaseChanges).toEqual([
      expect.objectContaining({
        collection: 'recipes',
        operation: 'create',
        after: expect.objectContaining({
          ingredients: [expect.objectContaining({ productCode: 'IT09679_N' })],
        }) as unknown,
      }),
    ]);
    const before = recipe.toObject();
    jest.spyOn(model, 'findById').mockReturnValue({
      lean: () => Promise.resolve(before),
    } as ReturnType<typeof model.findById>);
    const update = jest.spyOn(model.collection, 'updateOne').mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    });
    recipe.ingredients[0].qty = 0.3;
    recipe.approvalHistory.push({
      rejectionReason: 'Adjust quantities',
      rejectedAt: new Date(),
    });
    const updateContext = { databaseChanges: [] };

    await auditRequestStorage.run(updateContext, () => recipe.save());

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateContext.databaseChanges).toEqual([
      expect.objectContaining({
        collection: 'recipes',
        operation: 'save',
        before: expect.objectContaining({
          ingredients: [expect.objectContaining({ qty: 0.2 })],
        }) as unknown,
        after: expect.objectContaining({
          ingredients: [expect.objectContaining({ qty: 0.3 })],
          approvalHistory: [
            expect.objectContaining({ rejectionReason: 'Adjust quantities' }),
          ],
        }) as unknown,
      }),
    ]);
    await connection.close();
  });

  it('uses the original ObjectId when loading the post-update snapshot', async () => {
    const { preHooks, postHooks } = setupPlugin();
    const id = new Types.ObjectId();
    const find = jest
      .fn()
      .mockReturnValueOnce(queryResult([{ _id: id, name: 'Before' }]))
      .mockReturnValueOnce(queryResult([{ _id: id, name: 'After' }]));
    const query = {
      model: { collection: { name: 'recipes' }, find },
      op: 'findOneAndUpdate',
      getFilter: () => ({ _id: id }),
    };
    const context = { databaseChanges: [] };

    await auditRequestStorage.run(context, async () => {
      await preHooks.get('findOneAndUpdate')?.call(query);
      await postHooks.get('findOneAndUpdate')?.call(query);
    });

    expect(find).toHaveBeenNthCalledWith(2, { _id: { $in: [id] } });
    expect(context.databaseChanges).toEqual([
      expect.objectContaining({
        before: expect.objectContaining({ _id: id.toHexString() }),
        after: expect.objectContaining({ _id: id.toHexString() }),
      }),
    ]);
  });

  it('does not reject the business operation when snapshot queries fail', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { preHooks, postHooks } = setupPlugin();
    const find = jest
      .fn()
      .mockReturnValue(queryResult(new Error('Snapshot unavailable')));
    const query = {
      model: { collection: { name: 'recipes' }, find },
      op: 'updateOne',
      getFilter: () => ({ _id: new Types.ObjectId() }),
    };

    await expect(
      auditRequestStorage.run({ databaseChanges: [] }, async () => {
        await preHooks.get('updateOne')?.call(query);
        await postHooks.get('updateOne')?.call(query);
      }),
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledTimes(2);

    logger.mockRestore();
  });
});
