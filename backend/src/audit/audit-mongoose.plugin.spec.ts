import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
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
