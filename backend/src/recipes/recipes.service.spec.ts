import { RecipesService } from './recipes.service';
import { AppRole } from '../auth/roles.constants';
import ExcelJS from 'exceljs';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type TestIngredient = Record<string, unknown> & {
  conversionMultiplier?: number;
};

type RecipeUpdatePayload = {
  $unset?: Record<string, unknown>;
  $set: Record<string, unknown> & {
    ingredients?: TestIngredient[];
  };
  $push?: Record<string, unknown>;
};

type RecipeCreatePayload = {
  parentRecipeId?: string;
};

describe('RecipesService site visibility', () => {
  const makeService = () => {
    const recipeModel = {
      create: jest.fn(),
      find: jest.fn(),
      aggregate: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
      exists: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      insertMany: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ approvalStatus: 'pending' }),
      }),
      findOneAndUpdate: jest.fn(),
      distinct: jest.fn(),
    };
    const recipeCodeCounterModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ seq: 1 }),
    };
    const users = {
      findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    };
    const sites = {
      findSummariesByCodes: jest.fn().mockResolvedValue(new Map()),
    };
    const rawMaterials = {
      findLookupByNormalizedCode: jest.fn().mockResolvedValue(null),
      findLookupsByNormalizedCodes: jest.fn().mockResolvedValue([]),
      findAvailableNormalizedCodesForSite: jest.fn().mockResolvedValue([]),
      findVendorPrices: jest.fn().mockResolvedValue([]),
    };
    const unitOfMeasures = {
      findActiveConversion: jest.fn().mockResolvedValue(null),
    };
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(null),
    };
    const workflowMail = {
      notifyRecipeSubmitted: jest.fn().mockResolvedValue(undefined),
      notifyRecipeDecision: jest.fn().mockResolvedValue(undefined),
    };
    const recipeSettingsModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ targetFoodCostRequired: false }),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ targetFoodCostRequired: false }),
      }),
    };

    const service = new RecipesService(
      recipeModel as never,
      recipeCodeCounterModel as never,
      rawMaterials as never,
      users as never,
      sites as never,
      unitOfMeasures as never,
      notifications as never,
      workflowMail as never,
      recipeSettingsModel as never,
    );
    jest
      .spyOn(
        service as unknown as {
          backfillMissingRecipeCodes: () => Promise<void>;
        },
        'backfillMissingRecipeCodes',
      )
      .mockResolvedValue(undefined);

    return {
      notifications,
      sites,
      rawMaterials,
      recipeModel,
      service,
      unitOfMeasures,
      workflowMail,
      recipeSettingsModel,
    };
  };

  describe('recipe block import', () => {
    const addBlock = (
      sheet: ExcelJS.Worksheet,
      name: string,
      count: number,
      steps: string[],
    ) => {
      sheet.addRow([
        'Recipe Name',
        'Category',
        'Base Pax',
        'Target Food Cost %',
        'Description',
        'No',
        'Type',
        'Product Code',
        'Name',
        'Prod Qty',
        'Prod UOM',
      ]);
      const start = sheet.rowCount + 1;
      for (let i = 0; i < count; i += 1) {
        sheet.addRow([
          i === 0 ? name : null,
          i === 0 ? 'Main Course' : null,
          i === 0 ? 10 : null,
          i === 0 ? 40 : null,
          i === 0 ? 'Notes' : null,
          i + 1,
          'IT',
          'IT001',
          'Fish',
          400,
          'gr',
        ]);
      }
      const methodStart = sheet.rowCount + 1;
      steps.forEach((step, index) => {
        sheet.addRow([
          null,
          null,
          null,
          null,
          null,
          index === 0 ? 'Cooking Method' : null,
          null,
          index + 1,
          step,
        ]);
      });
      if (steps.length) sheet.mergeCells(methodStart, 6, sheet.rowCount, 7);
      for (let col = 1; col <= 5; col += 1) {
        if (sheet.rowCount > start)
          sheet.mergeCells(start, col, sheet.rowCount, col);
      }
      sheet.addRow([]);
    };
    const configureMaterials = (setup: ReturnType<typeof makeService>) => {
      setup.rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        productCode: 'IT001',
        productCodeNormalized: 'it001',
        name: 'Master fish',
        unitOfMeasures: 'KG',
      } as never);
      setup.rawMaterials.findVendorPrices.mockResolvedValue([
        { vendor: 'Vendor A', unitOfMeasures: 'KG', price: 29000 },
        { vendor: 'Vendor B', unitOfMeasures: 'KG', price: 28000 },
      ] as never);
      setup.unitOfMeasures.findActiveConversion.mockResolvedValue({
        prodUomCode: 'GR',
        srUomCode: 'KG',
        conversionId: 'GR To KG',
        multiplier: 0.001,
      } as never);
    };

    it('reads merged recipe metadata, repeated headers and different ingredient/step counts', async () => {
      const setup = makeService();
      configureMaterials(setup);
      const sheet = new ExcelJS.Workbook().addWorksheet('Recipes');
      addBlock(sheet, 'Woku', 3, ['Wash fish', 'Cook fish']);
      addBlock(sheet, 'Soup', 1, ['Simmer']);
      addBlock(sheet, 'Rice', 2, []);
      const parsed = await setup.service['parseImportWorksheet'](
        sheet,
        'SITE-A',
      );
      expect(parsed.records.map((r) => r.ingredients?.length)).toEqual([
        3, 1, 2,
      ]);
      expect(parsed.records.map((r) => r.cookingMethod)).toEqual([
        ['Wash fish', 'Cook fish'],
        ['Simmer'],
        [],
      ]);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.records[0]).toMatchObject({
        name: 'Woku',
        category: 'Main Course',
        portionSize: 10,
        targetFoodCostPercentage: 40,
        description: 'Notes',
        foodCostRecipe: 34800,
      });
      expect(parsed.records[0].ingredients?.[0]).toMatchObject({
        name: 'Master fish',
        prodQty: 400,
        prodUomCode: 'GR',
        srQty: 0.4,
        vendor: 'Vendor A',
        priceUom: 29000,
        foodCost: 11600,
      });
      await setup.service.bulkCreate(parsed.records, {
        id: 'chef',
        site: 'SITE-A',
      });
      expect(setup.recipeModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            isDraft: true,
            approvalStatus: 'pending',
            cookingMethod: ['Wash fish', 'Cook fish'],
          }),
        ]),
        { ordered: false },
      );
      expect(
        setup.notifications.createHierarchicalNotification,
      ).not.toHaveBeenCalled();
      expect(setup.workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
    });

    it('imports an actual XLSX file as drafts with generated codes and no notifications', async () => {
      const setup = makeService();
      configureMaterials(setup);
      const workbook = new ExcelJS.Workbook();
      addBlock(workbook.addWorksheet('Recipes'), 'Woku', 2, [
        'Wash fish',
        'Cook fish',
      ]);
      setup.recipeModel.insertMany.mockImplementation((rows: object[]) =>
        Promise.resolve(rows),
      );
      const directory = await mkdtemp(join(tmpdir(), 'recipe-block-test-'));
      const file = join(directory, 'recipes.xlsx');
      try {
        await workbook.xlsx.writeFile(file);
        const result = await setup.service.importFromExcel(file, {
          id: 'chef',
          site: 'SITE-A',
        });
        expect(result).toMatchObject({
          insertedCount: 1,
          draftsCount: 1,
          ingredientsCount: 2,
          warningsCount: 0,
        });
        expect(setup.recipeModel.insertMany).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              recipeCode: 'RCP0001',
              isDraft: true,
              site: 'SITE-A',
              createdBy: 'chef',
              cookingMethod: ['Wash fish', 'Cook fish'],
            }),
          ],
          { ordered: false },
        );
        expect(
          setup.notifications.createHierarchicalNotification,
        ).not.toHaveBeenCalled();
        expect(setup.workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
      } finally {
        await unlink(file);
        await rmdir(directory);
      }
    });

    it('retains missing materials, quantities, conversions and prices as draft issues without a partial total', async () => {
      const setup = makeService();
      configureMaterials(setup);
      setup.rawMaterials.findVendorPrices.mockResolvedValue([]);
      setup.unitOfMeasures.findActiveConversion.mockResolvedValue(null);
      const sheet = new ExcelJS.Workbook().addWorksheet('Recipes');
      addBlock(sheet, 'Incomplete', 3, []);
      sheet.getCell('H3').value = 'UNKNOWN';
      sheet.getCell('J4').value = null;
      setup.rawMaterials.findLookupByNormalizedCode
        .mockResolvedValueOnce({
          productCode: 'IT001',
          name: 'Fish',
          unitOfMeasures: 'KG',
        } as never)
        .mockResolvedValueOnce(null);
      const parsed = await setup.service['parseImportWorksheet'](
        sheet,
        'SITE-A',
      );
      const recipe = parsed.records[0];
      expect(recipe.ingredients).toHaveLength(3);
      expect(recipe.foodCostRecipe).toBeUndefined();
      expect(recipe.importIssues?.join(' ')).toMatch(/Conversion/);
      expect(recipe.importIssues?.join(' ')).toMatch(/no valid vendor price/);
      expect(recipe.importIssues?.join(' ')).toMatch(/product code not found/);
      expect(recipe.importIssues?.join(' ')).toMatch(/positive Prod Qty/);
      expect(recipe.ingredients?.[0].srQty).toBeUndefined();
      expect(recipe.ingredients?.[0].foodCost).toBeUndefined();
    });

    it('calculates SR Qty even when a vendor price is missing', async () => {
      const setup = makeService();
      configureMaterials(setup);
      setup.rawMaterials.findVendorPrices.mockResolvedValue([]);
      const sheet = new ExcelJS.Workbook().addWorksheet('Recipes');
      addBlock(sheet, 'No price', 1, []);
      const parsed = await setup.service['parseImportWorksheet'](
        sheet,
        'SITE-A',
      );
      expect(parsed.records[0].ingredients?.[0].srQty).toBe(0.4);
      expect(parsed.records[0].ingredients?.[0].priceUom).toBeUndefined();
      expect(parsed.records[0].foodCostRecipe).toBeUndefined();
    });

    it('reuses lookups for 1000 recipes and preserves separate blocks with the same name', async () => {
      const setup = makeService();
      configureMaterials(setup);
      const sheet = new ExcelJS.Workbook().addWorksheet('Recipes');
      for (let i = 0; i < 1000; i += 1) addBlock(sheet, 'Same name', 1, []);
      const parsed = await setup.service['parseImportWorksheet'](
        sheet,
        'SITE-A',
      );
      expect(parsed.records).toHaveLength(1000);
      expect(
        setup.rawMaterials.findLookupByNormalizedCode,
      ).toHaveBeenCalledTimes(1);
      expect(setup.rawMaterials.findVendorPrices).toHaveBeenCalledTimes(1);
      expect(setup.unitOfMeasures.findActiveConversion).toHaveBeenCalledTimes(
        1,
      );
    });

    it('blocks submit when current pricing is missing, even if saved draft issues were empty', async () => {
      const setup = makeService();
      configureMaterials(setup);
      setup.rawMaterials.findVendorPrices.mockResolvedValue([]);
      setup.recipeModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: 'Woku',
          category: 'Main',
          portionSize: 10,
          site: 'SITE-A',
          importIssues: [],
          ingredients: [
            {
              ingredientType: 'IT',
              productCode: 'IT001',
              prodQty: 400,
              prodUomCode: 'GRAM',
              srQty: 0.4,
              priceUom: 29000,
            },
          ],
        }),
      });
      await expect(
        setup.service.submitDraft('draft', { id: 'chef' }),
      ).rejects.toThrow('no valid vendor price');
      expect(setup.recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(
        setup.notifications.createHierarchicalNotification,
      ).not.toHaveBeenCalled();
    });

    it.each([AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin])(
      'submits a complete imported draft as %s without conflicting total updates',
      async (role) => {
        const setup = makeService();
        configureMaterials(setup);
        setup.recipeModel.findOne.mockReturnValue(
          mockRecipeQuery({
            _id: 'draft',
            name: 'Woku',
            category: 'Main',
            portionSize: 10,
            site: 'SITE-A',
            importIssues: [],
            ingredients: [
              {
                ingredientType: 'IT',
                productCode: 'IT001',
                prodQty: 400,
                prodUomCode: 'GR',
              },
            ],
          }),
        );
        setup.recipeModel.findOneAndUpdate.mockReturnValue(
          mockRecipeQuery({ _id: 'draft', name: 'Woku', site: 'SITE-A' }),
        );
        await setup.service.submitDraft('draft', {
          id: 'chef',
          roles: [role],
          site: 'SITE-A',
        });
        const update = getUpdatePayload(setup.recipeModel);
        expect(update.$set).toMatchObject({ isDraft: false, importIssues: [] });
        expect(update.$set.ingredients?.[0]).toMatchObject({
          srQty: 0.4,
          priceUom: 29000,
        });
        if (role === AppRole.Chef) {
          expect(update.$set.foodCostRecipe).toBe(11600);
          expect(
            setup.notifications.createHierarchicalNotification,
          ).toHaveBeenCalledTimes(2);
        } else {
          expect(update.$set.foodCostRecipe).toBeUndefined();
          expect(update.$unset?.foodCostRecipe).toBe('');
          expect(
            setup.notifications.createHierarchicalNotification,
          ).not.toHaveBeenCalled();
        }
      },
    );

    it('clears draft issues and recalculates costs when the missing price is fixed', async () => {
      const setup = makeService();
      configureMaterials(setup);
      setup.recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({
          isDraft: true,
          name: 'Woku',
          category: 'Main',
          portionSize: 10,
          site: 'SITE-A',
          importIssues: ['Missing price'],
          ingredients: [
            {
              ingredientType: 'IT',
              productCode: 'IT001',
              prodQty: 400,
              prodUomCode: 'GR',
            },
          ],
        }),
      );
      setup.recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'draft' }),
      );
      await setup.service.updateById(
        'draft',
        { saveAsDraft: true, cookingMethod: ['Wash', 'Cook'] },
        { id: 'chef' },
      );
      expect(getUpdatePayload(setup.recipeModel).$set).toMatchObject({
        importIssues: [],
        foodCostRecipe: 11600,
        cookingMethod: ['Wash', 'Cook'],
      });
      expect(
        setup.notifications.createHierarchicalNotification,
      ).not.toHaveBeenCalled();
    });

    it.each([
      [AppRole.Chef, 'product'],
      [AppRole.CorporateChef, 'product'],
      [AppRole.Superadmin, 'product'],
      [AppRole.Chef, 'global'],
      [AppRole.CorporateChef, 'global'],
      [AppRole.Superadmin, 'global'],
    ] as const)(
      'rechecks an imported draft as %s after adding a %s conversion without submitting it',
      async (role, conversionType) => {
        const setup = makeService();
        const rawMaterial = {
          productCode: 'IT01060',
          productCodeNormalized: 'it01060',
          name: 'Sauce',
          unitOfMeasures: 'GAL',
        };
        setup.rawMaterials.findLookupByNormalizedCode.mockResolvedValue(
          rawMaterial as never,
        );
        setup.rawMaterials.findVendorPrices.mockResolvedValue([
          { vendor: 'Vendor A', unitOfMeasures: 'GAL', price: 100000 },
        ] as never);
        setup.recipeModel.findOne.mockReturnValue(
          mockRecipeQuery({
            isDraft: true,
            approvalStatus: 'pending',
            name: 'Nuoc Cham',
            category: 'Sauce',
            portionSize: 10,
            site: 'SITE-A',
            importIssues: [
              'Ingredient 1 (IT01060): Conversion ML To GAL is not configured.',
            ],
            ingredients: [
              {
                ingredientType: 'IT',
                productCode: 'IT01060',
                prodQty: 500,
                prodUomCode: 'ML',
              },
            ],
          }),
        );
        setup.recipeModel.findOneAndUpdate.mockReturnValue(
          mockRecipeQuery({ _id: 'draft' }),
        );
        const actor = {
          id: 'chef',
          roles: [role],
          site: role === AppRole.Superadmin ? 'SITE-B' : 'SITE-A',
        };

        await setup.service.updateById('draft', { saveAsDraft: true }, actor);
        const before = getUpdatePayload(setup.recipeModel);
        expect(before.$set.importIssues).toEqual([
          'Ingredient 1 (IT01060): Conversion ML To GAL is not configured.',
        ]);
        expect(before.$set.ingredients?.[0].srQty).toBeUndefined();
        expect(before.$unset?.foodCostRecipe).toBe('');

        if (conversionType === 'product') {
          setup.rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
            ...rawMaterial,
            specificConversions: [
              { prodUomCode: 'ML', srUomCode: 'GAL', conversionFactor: 2000 },
            ],
          } as never);
        } else {
          setup.unitOfMeasures.findActiveConversion.mockResolvedValue({
            prodUomCode: 'ML',
            srUomCode: 'GAL',
            conversionId: 'ML To GAL',
            multiplier: 1 / 2000,
          } as never);
        }

        setup.recipeModel.findOneAndUpdate.mockClear();
        await setup.service.updateById('draft', { saveAsDraft: true }, actor);
        const after = getUpdatePayload(setup.recipeModel);
        expect(after.$set).toMatchObject({
          importIssues: [],
          foodCostRecipe: 25000,
          ingredients: [
            expect.objectContaining({
              prodQty: 500,
              srQty: 0.25,
              qty: 0.25,
              conversionId: 'ML To GAL',
              conversionMultiplier: 1 / 2000,
              priceUom: 100000,
              foodCost: 25000,
            }),
          ],
        });
        expect(after.$set.isDraft).toBeUndefined();
        expect(after.$set.approvalStatus).toBeUndefined();
        expect(after.$set.status).toBeUndefined();
        expect(after.$set.createdBy).toBeUndefined();
        expect(after.$set.site).toBeUndefined();
        expect(setup.rawMaterials.findVendorPrices).toHaveBeenLastCalledWith({
          productCode: 'IT01060',
          site: 'SITE-A',
        });
        expect(
          setup.notifications.createHierarchicalNotification,
        ).not.toHaveBeenCalled();
        expect(setup.workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
      },
    );

    describe('bulk draft recheck', () => {
      const actor = { id: 'chef', roles: [AppRole.Superadmin], site: 'SITE-A' };
      const makeDraft = (index: number) => ({
        _id: index.toString(16).padStart(24, '0'),
        createdBy: `author-${index}`,
        name: 'Imported recipe',
        category: 'Main',
        portionSize: 10,
        site: 'SITE-A',
        isDraft: true,
        approvalStatus: 'pending',
        importIssues: ['Conversion GR To KG is not configured.'],
        updatedAt: new Date('2026-10-19T00:00:00Z'),
        ingredients: [
          {
            ingredientType: 'IT',
            productCode: 'IT001',
            prodQty: 400,
            prodUomCode: 'GR',
          },
        ],
      });
      const mockBatch = (drafts: object[]) => ({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(drafts),
      });
      const makeRecheckSetup = (drafts: object[]) => {
        const setup = makeService();
        configureMaterials(setup);
        setup.recipeModel.find.mockReturnValue(mockBatch(drafts));
        setup.recipeModel.updateOne.mockResolvedValue({ matchedCount: 1 });
        return setup;
      };

      it.each([AppRole.Chef, AppRole.CorporateChef])(
        'rejects bulk rechecks by %s before reading or updating drafts',
        async (role) => {
          const setup = makeRecheckSetup([]);
          await expect(
            setup.service.recheckDrafts({ ...actor, roles: [role] }),
          ).rejects.toThrow('Only Superadmin can bulk recheck drafts.');
          expect(setup.recipeModel.find).not.toHaveBeenCalled();
          expect(setup.recipeModel.updateOne).not.toHaveBeenCalled();
        },
      );

      it('loads all imported drafts with issues regardless of the Superadmin site', async () => {
        const setup = makeRecheckSetup([]);
        const result = await setup.service.recheckDrafts({
          ...actor,
          sites: ['SITE-A'],
        });
        expect(setup.recipeModel.find).toHaveBeenCalledWith({
          isDraft: true,
          deletedAt: { $exists: false },
          'importIssues.0': { $exists: true },
        });
        expect(result).toEqual({
          checkedCount: 0,
          resolvedCount: 0,
          remainingCount: 0,
          skippedCount: 0,
          nextCursor: null,
        });
        expect(setup.recipeModel.updateOne).not.toHaveBeenCalled();
      });

      it('recalculates drafts from different users and sites with shared conversion lookups and each recipe site price', async () => {
        const drafts = [
          makeDraft(1),
          makeDraft(2),
          { ...makeDraft(3), site: 'SITE-B' },
        ];
        const setup = makeRecheckSetup(drafts);
        setup.rawMaterials.findVendorPrices.mockResolvedValueOnce([
          { vendor: 'Vendor A', unitOfMeasures: 'KG', price: 29000 },
        ] as never);
        setup.rawMaterials.findVendorPrices.mockResolvedValueOnce([
          { vendor: 'Vendor B', unitOfMeasures: 'KG', price: 10000 },
        ] as never);
        expect(await setup.service.recheckDrafts(actor)).toEqual({
          checkedCount: 3,
          resolvedCount: 3,
          remainingCount: 0,
          skippedCount: 0,
          nextCursor: null,
        });
        expect(setup.recipeModel.updateOne).toHaveBeenCalledTimes(3);
        for (const [index, draft] of drafts.entries()) {
          expect(setup.recipeModel.updateOne).toHaveBeenNthCalledWith(
            index + 1,
            {
              _id: draft._id,
              updatedAt: draft.updatedAt,
              isDraft: true,
              deletedAt: { $exists: false },
              'importIssues.0': { $exists: true },
            },
            {
              $set: {
                ingredients: [
                  expect.objectContaining({ srQty: 0.4, prodQty: 400 }),
                ],
                importIssues: [],
                foodCostRecipe: index === 2 ? 4000 : 11600,
                updatedBy: 'chef',
              },
            },
          );
        }
        expect(
          setup.rawMaterials.findLookupByNormalizedCode,
        ).toHaveBeenCalledTimes(1);
        expect(setup.unitOfMeasures.findActiveConversion).toHaveBeenCalledTimes(
          1,
        );
        expect(setup.rawMaterials.findVendorPrices).toHaveBeenCalledTimes(2);
        expect(setup.rawMaterials.findVendorPrices).toHaveBeenLastCalledWith({
          productCode: 'IT001',
          site: 'SITE-B',
        });
        expect(
          setup.notifications.createHierarchicalNotification,
        ).not.toHaveBeenCalled();
        expect(setup.workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
      });

      it('retains unresolved issues and removes stale total costs', async () => {
        const setup = makeRecheckSetup([makeDraft(1)]);
        setup.unitOfMeasures.findActiveConversion.mockResolvedValue(null);
        expect(await setup.service.recheckDrafts(actor)).toMatchObject({
          checkedCount: 1,
          resolvedCount: 0,
          remainingCount: 1,
        });
        const calls = setup.recipeModel.updateOne.mock
          .calls as unknown as Array<[unknown, RecipeUpdatePayload]>;
        const update = calls[0][1];
        expect(update.$set.importIssues).toEqual([
          'Ingredient 1 (IT001): Conversion GR To KG is not configured.',
        ]);
        expect(update.$set.foodCostRecipe).toBeUndefined();
        expect(update.$unset).toEqual({ foodCostRecipe: '' });
      });

      it('continues past the first 50 drafts without skipping rows as issues are cleared', async () => {
        const drafts = Array.from({ length: 52 }, (_, index) =>
          makeDraft(index + 1),
        );
        const setup = makeRecheckSetup([]);
        const firstBatch = mockBatch(drafts.slice(0, 51));
        setup.recipeModel.find
          .mockReturnValueOnce(firstBatch)
          .mockReturnValueOnce(mockBatch(drafts.slice(50)));
        const first = await setup.service.recheckDrafts(actor);
        expect(first).toMatchObject({
          checkedCount: 50,
          nextCursor: drafts[49]._id,
        });
        expect(firstBatch.sort).toHaveBeenCalledWith({ _id: 1 });
        expect(firstBatch.limit).toHaveBeenCalledWith(51);
        const second = await setup.service.recheckDrafts(actor, {
          afterId: first.nextCursor!,
        });
        expect(second).toMatchObject({ checkedCount: 2, nextCursor: null });
        expect(setup.recipeModel.find).toHaveBeenLastCalledWith(
          expect.objectContaining({ _id: { $gt: drafts[49]._id } }),
        );
        expect(setup.recipeModel.updateOne).toHaveBeenCalledTimes(52);
      });

      it('reports drafts changed or submitted during checking without counting them as resolved', async () => {
        const setup = makeRecheckSetup([makeDraft(1)]);
        setup.recipeModel.updateOne.mockResolvedValue({ matchedCount: 0 });
        expect(await setup.service.recheckDrafts(actor)).toEqual({
          checkedCount: 0,
          resolvedCount: 0,
          remainingCount: 0,
          skippedCount: 1,
          nextCursor: null,
        });
      });

      it('rejects missing identity and propagates database failures', async () => {
        const setup = makeRecheckSetup([makeDraft(1)]);
        await expect(setup.service.recheckDrafts()).rejects.toThrow(
          'Recipe author identity is required',
        );
        expect(setup.recipeModel.find).not.toHaveBeenCalled();
        setup.rawMaterials.findVendorPrices.mockRejectedValue(
          new Error('Database unavailable'),
        );
        await expect(setup.service.recheckDrafts(actor)).rejects.toThrow(
          'Database unavailable',
        );
        expect(setup.recipeModel.updateOne).not.toHaveBeenCalled();
      });
    });

    it('keeps legacy table and recipe-card imports available', async () => {
      const setup = makeService();
      const workbook = new ExcelJS.Workbook();
      const legacy = workbook.addWorksheet('Legacy');
      legacy.addRows([
        ['name', 'category', 'portion'],
        ['Soup', 'Main', 10],
      ]);
      expect(
        (await setup.service['parseImportWorksheet'](legacy)).records[0],
      ).toMatchObject({ name: 'Soup', portionSize: 10, ingredients: [] });
      const card = workbook.addWorksheet('Card');
      card.addRows([
        ['RECIPE CARD'],
        ['Recipe Name', 'Fish'],
        ['Food Type', 'Main'],
        ['Portion', 10],
        ['QTY', 'PRODUCT CODE', 'INGREDIENT'],
        [1, 'IT001', 'Fish'],
      ]);
      expect(
        (await setup.service['parseImportWorksheet'](card)).records[0],
      ).toMatchObject({
        name: 'Fish',
        portionSize: 10,
        ingredients: [
          expect.objectContaining({ productCode: 'IT001', qty: 1 }),
        ],
      });
    });

    it('rejects incorrect headers and duplicate step numbers before inserting', async () => {
      const setup = makeService();
      const sheet = new ExcelJS.Workbook().addWorksheet('Recipes');
      addBlock(sheet, 'Woku', 1, ['Wash', 'Cook']);
      sheet.getCell('H4').value = 1;
      await expect(
        setup.service['parseImportWorksheet'](sheet, 'SITE-A'),
      ).rejects.toThrow('unique positive step number');
      sheet.getCell('J1').value = 'Wrong Qty';
      await expect(
        setup.service['parseImportWorksheet'](sheet, 'SITE-A'),
      ).rejects.toThrow('expected prod qty');
      expect(setup.recipeModel.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('recipe draft visibility', () => {
    it('allows superadmins to list drafts from every author and site', async () => {
      const { service, recipeModel } = makeService();
      const drafts = [
        { _id: 'draft-a', createdBy: 'chef-a', site: 'SITE-A' },
        { _id: 'draft-b', createdBy: 'chef-b', site: 'SITE-B' },
      ];
      recipeModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(drafts),
      });
      recipeModel.countDocuments.mockResolvedValue(42);
      recipeModel.distinct.mockResolvedValue(['Main', 'Soup']);

      await expect(
        service.findDrafts(
          {
            id: 'admin',
            roles: [AppRole.Superadmin],
            site: 'SITE-A',
          },
          { page: 2, limit: 20, category: 'Main', issueStatus: 'issues' },
        ),
      ).resolves.toEqual({
        items: drafts,
        total: 42,
        page: 2,
        limit: 20,
        totalPages: 3,
        categories: ['Main', 'Soup'],
      });
      const baseFilter = {
        isDraft: true,
        deletedAt: { $exists: false },
      };
      const filtered = {
        ...baseFilter,
        category: 'Main',
        'importIssues.0': { $exists: true },
      };
      expect(recipeModel.aggregate).toHaveBeenCalledWith([
        { $match: filtered },
        { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
        { $skip: 20 },
        { $limit: 20 },
        {
          $project: {
            recipeCode: 1,
            name: 1,
            category: 1,
            createdBy: 1,
            createdByEmail: 1,
            site: 1,
            importIssues: 1,
            updatedAt: 1,
            ingredientsCount: { $size: { $ifNull: ['$ingredients', []] } },
          },
        },
      ]);
      expect(recipeModel.countDocuments).toHaveBeenCalledWith(filtered);
      expect(recipeModel.distinct).toHaveBeenCalledWith('category', baseFilter);
    });

    it.each([AppRole.Chef, AppRole.CorporateChef])(
      'keeps %s drafts limited to their author and site scope',
      async (role) => {
        const { service, recipeModel } = makeService();
        recipeModel.aggregate.mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        });
        recipeModel.distinct.mockResolvedValue([]);

        await service.findDrafts(
          {
            id: 'chef',
            roles: [role],
            site: 'SITE-A',
            sites: ['SITE-A', 'SITE-B'],
          },
          { issueStatus: 'no-issues' },
        );
        const scopedFilter = {
          createdBy: 'chef',
          isDraft: true,
          deletedAt: { $exists: false },
          site:
            role === AppRole.CorporateChef
              ? { $in: ['SITE-A', 'SITE-B'] }
              : 'SITE-A',
        };
        expect(recipeModel.aggregate).toHaveBeenCalledWith(
          expect.arrayContaining([
            {
              $match: { ...scopedFilter, 'importIssues.0': { $exists: false } },
            },
            { $skip: 0 },
            { $limit: 20 },
          ]),
        );
        expect(recipeModel.distinct).toHaveBeenCalledWith(
          'category',
          scopedFilter,
        );
      },
    );

    it('requires an authenticated author identity even for superadmins', async () => {
      const { service, recipeModel } = makeService();
      await expect(
        service.findDrafts({ roles: [AppRole.Superadmin] }),
      ).rejects.toThrow('Recipe author identity is required');
      expect(recipeModel.aggregate).not.toHaveBeenCalled();
    });

    it('loads one full draft only within the actor scope', async () => {
      const { service, recipeModel } = makeService();
      const id = '507f1f77bcf86cd799439011';
      const draft = { _id: id, ingredients: [{ name: 'Fish' }] };
      recipeModel.findOne.mockReturnValue(mockRecipeQuery(draft));
      await expect(
        service.findDraftById(id, {
          id: 'chef',
          roles: [AppRole.Chef],
          site: 'SITE-A',
        }),
      ).resolves.toEqual(draft);
      expect(recipeModel.findOne).toHaveBeenCalledWith({
        _id: id,
        createdBy: 'chef',
        isDraft: true,
        deletedAt: { $exists: false },
        site: 'SITE-A',
      });
      await service.findDraftById(id, {
        id: 'admin',
        roles: [AppRole.Superadmin],
        site: 'SITE-A',
      });
      expect(recipeModel.findOne).toHaveBeenLastCalledWith({
        _id: id,
        isDraft: true,
        deletedAt: { $exists: false },
      });
      recipeModel.findOne.mockReturnValue(mockRecipeQuery(null));
      await expect(
        service.findDraftById(id, {
          id: 'chef',
          roles: [AppRole.Chef],
          site: 'SITE-A',
        }),
      ).rejects.toThrow('Recipe draft not found');
      await expect(
        service.findDraftById('invalid', {
          id: 'chef',
          roles: [AppRole.Chef],
          site: 'SITE-A',
        }),
      ).rejects.toThrow('Recipe draft not found');
    });
  });

  describe('delete recipe drafts', () => {
    it.each([AppRole.Chef, AppRole.CorporateChef])(
      'soft deletes only an owned draft for %s',
      async (role) => {
        const { service, recipeModel, notifications, workflowMail } =
          makeService();
        recipeModel.findOneAndUpdate.mockReturnValue(
          mockRecipeQuery({ _id: 'draft-1', recipeCode: 'RCP0001' }),
        );
        await expect(
          service.deleteDraft('draft-1', {
            id: 'author',
            site: 'SITE-A',
            roles: [role],
          }),
        ).resolves.toEqual({ id: 'draft-1', recipeCode: 'RCP0001' });
        expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: 'draft-1',
            createdBy: 'author',
            isDraft: true,
            deletedAt: { $exists: false },
            site:
              role === AppRole.CorporateChef ? { $in: ['SITE-A'] } : 'SITE-A',
          },
          expect.any(Object),
          { new: true },
        );
        const update = getUpdatePayload(recipeModel);
        expect(update.$set).toMatchObject({
          isActive: false,
          updatedBy: 'author',
        });
        expect(update.$set.deletedAt).toBeInstanceOf(Date);
        expect(
          notifications.createHierarchicalNotification,
        ).not.toHaveBeenCalled();
        expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
      },
    );

    it('requires author identity before deleting a draft', async () => {
      const { service, recipeModel } = makeService();
      await expect(service.deleteDraft('draft-1')).rejects.toThrow(
        'Recipe author identity is required',
      );
      expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      { createdBy: 'other-chef', isDraft: true },
      { createdBy: 'author', isDraft: false },
    ])(
      'does not delete a recipe that is not an owned draft: %o',
      async (stored) => {
        const { service, recipeModel } = makeService();
        recipeModel.findOneAndUpdate.mockImplementation(
          (filter: { createdBy: string; isDraft: boolean }) =>
            mockRecipeQuery(
              filter.createdBy === stored.createdBy &&
                filter.isDraft === stored.isDraft
                ? { _id: 'recipe-1' }
                : null,
            ),
        );
        await expect(
          service.deleteDraft('recipe-1', {
            id: 'author',
            roles: [AppRole.Chef],
          }),
        ).rejects.toThrow('Recipe draft not found');
      },
    );
  });

  describe('superadmin draft management', () => {
    const actor = {
      id: 'admin',
      roles: [AppRole.Superadmin],
      site: 'SITE-A',
    };
    const draft = {
      _id: 'other-draft',
      createdBy: 'other-chef',
      site: 'SITE-B',
      isDraft: true,
      name: 'Ready Recipe',
      category: 'Main',
      ingredients: [{ name: 'Ingredient', qty: 1, unitOfMeasures: 'KG' }],
    };
    const draftFilter = {
      _id: draft._id,
      isDraft: true,
      deletedAt: { $exists: false },
    };

    it('soft deletes another author draft across sites and records the admin', async () => {
      const { service, recipeModel } = makeService();
      recipeModel.findOneAndUpdate.mockReturnValue(mockRecipeQuery(draft));
      await service.deleteDraft(draft._id, actor);
      expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
        draftFilter,
        expect.any(Object),
        { new: true },
      );
      const update = getUpdatePayload(recipeModel).$set;
      expect(update).toMatchObject({
        isActive: false,
        updatedBy: actor.id,
      });
      expect(update.deletedAt).toBeInstanceOf(Date);
      expect(update.createdBy).toBeUndefined();
    });

    it.each([
      { roles: [AppRole.Superadmin] },
      { roles: [AppRole.Superadmin, AppRole.Chef, AppRole.CorporateChef] },
    ])(
      'edits another author draft without changing ownership with roles $roles',
      async ({ roles }) => {
        const { service, recipeModel } = makeService();
        recipeModel.findOne.mockReturnValue(mockRecipeQuery(draft));
        recipeModel.findOneAndUpdate.mockReturnValue(mockRecipeQuery(draft));
        await service.updateById(
          draft._id,
          { name: 'Updated Draft', saveAsDraft: true },
          { ...actor, roles },
        );
        expect(recipeModel.findOne).toHaveBeenCalledWith({ _id: draft._id });
        expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
          draftFilter,
          { $set: { name: 'Updated Draft', updatedBy: actor.id } },
          { new: true },
        );
      },
    );

    it('submits another author draft across sites and records the reviewer', async () => {
      const { service, recipeModel, notifications, workflowMail } =
        makeService();
      recipeModel.findOne.mockReturnValue(mockRecipeQuery(draft));
      recipeModel.findOneAndUpdate.mockReturnValue(mockRecipeQuery(draft));
      await service.submitDraft(draft._id, actor);
      expect(recipeModel.findOne).toHaveBeenCalledWith(draftFilter);
      expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
        draftFilter,
        expect.any(Object),
        { new: true },
      );
      const update = getUpdatePayload(recipeModel).$set;
      expect(update).toMatchObject({
        isDraft: false,
        approvalStatus: 'approved',
        status: 'active',
        updatedBy: actor.id,
        reviewedBy: actor.id,
      });
      expect(update.createdBy).toBeUndefined();
      expect(update.site).toBeUndefined();
      expect(
        notifications.createHierarchicalNotification,
      ).not.toHaveBeenCalled();
      expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
    });

    it('still rejects incomplete drafts when a superadmin submits them', async () => {
      const { service, recipeModel } = makeService();
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({ ...draft, ingredients: [] }),
      );
      await expect(service.submitDraft(draft._id, actor)).rejects.toThrow(
        'Add at least 1 ingredient',
      );
      expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([AppRole.Chef, AppRole.CorporateChef])(
      'keeps draft submission scoped to the author for %s',
      async (role) => {
        const { service, recipeModel } = makeService();
        recipeModel.findOne.mockReturnValue(mockRecipeQuery(null));
        await expect(
          service.submitDraft(draft._id, { ...actor, roles: [role] }),
        ).rejects.toThrow('Recipe draft not found');
        expect(recipeModel.findOne).toHaveBeenCalledWith({
          ...draftFilter,
          createdBy: actor.id,
          site: role === AppRole.CorporateChef ? { $in: ['SITE-A'] } : 'SITE-A',
        });
        expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );
  });

  const getUpdatePayload = (
    recipeModel: ReturnType<typeof makeService>['recipeModel'],
  ): RecipeUpdatePayload => {
    const calls = recipeModel.findOneAndUpdate.mock.calls as unknown as Array<
      [unknown, RecipeUpdatePayload]
    >;
    const payload = calls[0]?.[1];
    if (!payload) throw new Error('findOneAndUpdate was not called.');
    return payload;
  };

  const getUpdatedIngredient = (
    recipeModel: ReturnType<typeof makeService>['recipeModel'],
  ) => {
    const ingredient = getUpdatePayload(recipeModel).$set.ingredients?.[0];
    if (!ingredient) throw new Error('Recipe ingredient was not updated.');
    return ingredient;
  };

  const mockRecipeList = (
    recipeModel: ReturnType<typeof makeService>['recipeModel'],
    items: unknown[] = [],
  ) => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(items),
    };
    recipeModel.find.mockReturnValue(query);
    return query;
  };

  const mockRecipeQuery = (result: unknown) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  const estimatedIngredient = {
    ingredientType: 'NMP' as const,
    productCode: 'NMP',
    name: 'Local ingredient',
    unitOfMeasures: 'KG',
    qty: 2,
    priceUom: 10,
    foodCost: 20,
  };

  describe('target food cost', () => {
    const requireTarget = (
      settingsModel: ReturnType<typeof makeService>['recipeSettingsModel'],
    ) => {
      settingsModel.findOne.mockReturnValue(
        mockRecipeQuery({ targetFoodCostRequired: true }),
      );
    };

    it('defaults to required when no settings document exists', async () => {
      const { service, recipeSettingsModel } = makeService();
      recipeSettingsModel.findOne.mockReturnValue(mockRecipeQuery(null));
      await expect(service.getSettings()).resolves.toEqual({
        targetFoodCostRequired: true,
      });
      await expect(
        service.create({ name: 'New', category: 'Main' }),
      ).rejects.toThrow('Target food cost percentage is required.');
    });

    it.each([AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin])(
      'requires a target for %s without assigning it to the selling price',
      async (role) => {
        const { service, recipeModel, recipeSettingsModel } = makeService();
        requireTarget(recipeSettingsModel);
        recipeModel.create.mockImplementation((payload: object) =>
          Promise.resolve({ _id: 'recipe', ...payload }),
        );
        await expect(
          service.create({ name: 'New', category: 'Main' }, { roles: [role] }),
        ).rejects.toThrow('Target food cost percentage is required.');
        await service.create(
          { name: 'New', category: 'Main', targetFoodCostPercentage: 45.5 },
          { roles: [role] },
        );
        expect(recipeModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            targetFoodCostPercentage: 45.5,
            price: 0,
          }),
        );
      },
    );

    it.each([0, -1, NaN, Infinity])(
      'rejects invalid percentage %s even when optional',
      async (target) => {
        const { service, recipeModel } = makeService();
        await expect(
          service.create({
            name: 'New',
            category: 'Main',
            targetFoodCostPercentage: target,
          }),
        ).rejects.toThrow('Target food cost must be a number greater than 0.');
        expect(recipeModel.create).not.toHaveBeenCalled();
      },
    );

    it('accepts percentages above 100 without a fixed selection', async () => {
      const { service, recipeModel } = makeService();
      recipeModel.create.mockImplementation((payload: object) =>
        Promise.resolve({ _id: 'recipe', ...payload }),
      );
      await service.create({
        name: 'New',
        category: 'Main',
        targetFoodCostPercentage: 125.25,
      });
      expect(recipeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetFoodCostPercentage: 125.25 }),
      );
    });

    it('requires filling the target when updating a legacy recipe and preserves existing prices', async () => {
      const { service, recipeModel, recipeSettingsModel } = makeService();
      requireTarget(recipeSettingsModel);
      recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'legacy', targetFoodCostPercentage: 40 }),
      );
      await expect(
        service.updateById('legacy', { name: 'Updated' }),
      ).rejects.toThrow('Target food cost percentage is required.');
      await service.updateById('legacy', { targetFoodCostPercentage: 40 });
      expect(getUpdatePayload(recipeModel).$set.targetFoodCostPercentage).toBe(
        40,
      );
      expect(getUpdatePayload(recipeModel).$set).not.toHaveProperty('price');
    });

    it('retains the stored target during partial updates and prevents clearing it while required', async () => {
      const { service, recipeModel, recipeSettingsModel } = makeService();
      requireTarget(recipeSettingsModel);
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({ targetFoodCostPercentage: 35 }),
      );
      recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'recipe' }),
      );
      await service.updateById('recipe', { name: 'Updated' });
      expect(getUpdatePayload(recipeModel).$set).not.toHaveProperty(
        'targetFoodCostPercentage',
      );
      await expect(
        service.updateById('recipe', { targetFoodCostPercentage: null }),
      ).rejects.toThrow('Target food cost percentage is required.');
    });

    it('allows clearing the target when optional', async () => {
      const { service, recipeModel } = makeService();
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({ targetFoodCostPercentage: 35 }),
      );
      recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'recipe' }),
      );
      await service.updateById('recipe', { targetFoodCostPercentage: null });
      expect(getUpdatePayload(recipeModel).$unset).toEqual({
        targetFoodCostPercentage: '',
      });
      expect(getUpdatePayload(recipeModel).$set).not.toHaveProperty('price');
    });

    it('checks targets before submitting old drafts or resubmitting rejected recipes', async () => {
      const { service, recipeModel, recipeSettingsModel } = makeService();
      requireTarget(recipeSettingsModel);
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({ approvalStatus: 'rejected' }),
      );
      await expect(
        service.submitDraft('draft', { id: 'chef' }),
      ).rejects.toThrow('Target food cost percentage is required.');
      await expect(
        service.resubmitRejectedRecipe('rejected', { id: 'chef' }, 'Fixed'),
      ).rejects.toThrow('Target food cost percentage is required.');
    });

    it('validates the entire import before inserting any recipes', async () => {
      const { service, recipeModel, recipeSettingsModel } = makeService();
      requireTarget(recipeSettingsModel);
      await expect(
        service.bulkCreate([
          { name: 'Valid', category: 'Main', targetFoodCostPercentage: 40 },
          { name: 'Missing', category: 'Main' },
        ]),
      ).rejects.toThrow('Target food cost percentage is required.');
      expect(recipeModel.create).not.toHaveBeenCalled();
      expect(recipeModel.insertMany).not.toHaveBeenCalled();
    });

    it('persists the global required/optional setting', async () => {
      const { service, recipeSettingsModel } = makeService();
      await expect(
        service.updateSettings({ targetFoodCostRequired: false }),
      ).resolves.toEqual({ targetFoodCostRequired: false });
      expect(recipeSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'global' },
        { $set: { targetFoodCostRequired: false } },
        { upsert: true, new: true, runValidators: true },
      );
    });

    it('keeps the target and selling price intact during recipe approval', async () => {
      const { service, recipeModel } = makeService();
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({
          ingredients: [estimatedIngredient],
          targetFoodCostPercentage: 40,
        }),
      );
      recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'recipe', targetFoodCostPercentage: 40 }),
      );
      const result = await service.setApprovalStatus('recipe', 'approved', {
        roles: [AppRole.CorporateChef],
        sites: ['SITE-A'],
      });
      expect(result.targetFoodCostPercentage).toBe(40);
      const payload = getUpdatePayload(recipeModel);
      expect(payload.$unset).not.toHaveProperty('targetFoodCostPercentage');
      expect(payload.$set).not.toHaveProperty('targetFoodCostPercentage');
      expect(payload.$set).not.toHaveProperty('price');
    });

    it('imports decimal targets and allows blank targets only when optional', async () => {
      const { service, recipeModel } = makeService();
      await service.bulkCreate([
        { name: 'Decimal', category: 'Main', targetFoodCostPercentage: 45.5 },
        { name: 'Optional', category: 'Main' },
      ]);
      expect(recipeModel.insertMany).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            name: 'Decimal',
            targetFoodCostPercentage: 45.5,
            price: 0,
          }),
          expect.objectContaining({
            name: 'Optional',
            targetFoodCostPercentage: undefined,
          }),
        ],
        { ordered: false },
      );
    });
  });

  it.each([AppRole.Chef, AppRole.CorporateChef])(
    'retains estimates while %s saves a draft',
    async (role) => {
      const { recipeModel, service } = makeService();
      recipeModel.create.mockImplementation((payload: object) =>
        Promise.resolve({ _id: 'draft', ...payload }),
      );
      await service.create(
        {
          name: 'Draft',
          category: 'Main',
          saveAsDraft: true,
          ingredients: [estimatedIngredient],
        },
        { id: 'author', roles: [role] },
      );
      expect(recipeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          foodCostRecipe: 20,
          ingredients: [estimatedIngredient],
          approvalStatus: 'pending',
        }),
      );
    },
  );

  it.each([AppRole.CorporateChef, AppRole.Superadmin])(
    'does not store estimates when %s creates an auto-approved recipe',
    async (role) => {
      const { recipeModel, service } = makeService();
      recipeModel.create.mockImplementation((payload: object) =>
        Promise.resolve({ _id: 'approved', ...payload }),
      );
      await service.create(
        {
          name: 'Approved',
          category: 'Main',
          foodCostRecipe: 20,
          ingredients: [estimatedIngredient],
        },
        { id: 'author', roles: [role] },
      );
      const calls = recipeModel.create.mock.calls as unknown as Array<
        [
          {
            foodCostRecipe?: number;
            ingredients: TestIngredient[];
          },
        ]
      >;
      expect(calls[0][0].foodCostRecipe).toBeUndefined();
      expect(calls[0][0].ingredients[0].foodCost).toBeUndefined();
      expect(calls[0][0].ingredients[0].priceUom).toBe(10);
    },
  );

  it.each([AppRole.CorporateChef, AppRole.UnitManager])(
    'expires estimates when approved by %s',
    async (role) => {
      const { recipeModel, service } = makeService();
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({ ingredients: [estimatedIngredient] }),
      );
      recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'approved' }),
      );
      await service.setApprovalStatus('recipe', 'approved', {
        id: 'approver',
        roles: [role],
      });
      const update = getUpdatePayload(recipeModel);
      expect(update.$unset?.foodCostRecipe).toBe('');
      expect(update.$set.foodCostRecipe).toBeUndefined();
      expect(update.$set.ingredients?.[0].foodCost).toBeUndefined();
      expect(update.$set.ingredients?.[0].qty).toBe(2);
    },
  );

  it('does not restore estimates when an approved recipe is edited', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue(
      mockRecipeQuery({ approvalStatus: 'approved' }),
    );
    recipeModel.findOneAndUpdate.mockReturnValue(
      mockRecipeQuery({ _id: 'approved' }),
    );
    await service.updateById('recipe', {
      foodCostRecipe: 20,
      ingredients: [estimatedIngredient],
    });
    const update = getUpdatePayload(recipeModel);
    expect(update.$unset?.foodCostRecipe).toBe('');
    expect(update.$set.foodCostRecipe).toBeUndefined();
    expect(update.$set.ingredients?.[0].foodCost).toBeUndefined();
  });

  it('creates an independent recipe as version 1', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({
        _id: 'recipe-v1',
        ...payload,
      }),
    );

    await service.create({
      name: 'Classic Cheesecake',
      category: 'Dessert',
      ingredients: [],
    });

    expect(recipeModel.findOne).not.toHaveBeenCalled();
    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeCode: 'RCP0001',
        name: 'Classic Cheesecake',
        version: 1,
        versionGroupId: 'RCP0001',
      }),
    );
    const createCalls = recipeModel.create.mock.calls as unknown as Array<
      [RecipeCreatePayload]
    >;
    expect(createCalls[0]?.[0].parentRecipeId).toBeUndefined();
  });

  it.each([AppRole.Chef, AppRole.Superadmin])(
    'stores a %s draft without notifying approvers',
    async (role) => {
      const { notifications, recipeModel, service, workflowMail } =
        makeService();
      recipeModel.create.mockImplementation((payload: object) =>
        Promise.resolve({ _id: 'recipe-draft', ...payload }),
      );

      await service.create(
        {
          name: 'Half Finished Recipe',
          category: 'Main Course',
          ingredients: [],
          saveAsDraft: true,
        },
        {
          id: 'chef-1',
          site: 'SITE-001',
          roles: [role],
        },
      );

      expect(recipeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalStatus: 'pending',
          isDraft: true,
          status: 'draft',
        }),
      );
      expect(
        notifications.createHierarchicalNotification,
      ).not.toHaveBeenCalled();
      expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
    },
  );

  it('creates the next version without changing the base recipe name', async () => {
    const { recipeModel, service } = makeService();
    const baseRecipe = {
      _id: 'recipe-v1',
      recipeCode: 'RCP0042',
      name: 'Classic Cheesecake',
    };
    recipeModel.findOne
      .mockReturnValueOnce(mockRecipeQuery(baseRecipe))
      .mockReturnValueOnce(mockRecipeQuery({ version: 1 }));
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({
        _id: 'recipe-v2',
        ...payload,
      }),
    );

    await service.create({
      baseRecipeId: 'recipe-v1',
      name: 'This name must be ignored',
      category: 'Dessert',
      ingredients: [],
    });

    expect(recipeModel.findOne).toHaveBeenNthCalledWith(1, {
      _id: 'recipe-v1',
      approvalStatus: 'approved',
      deletedAt: { $exists: false },
    });
    expect(recipeModel.updateOne).toHaveBeenCalledWith(
      { _id: 'recipe-v1' },
      {
        $set: {
          version: 1,
          versionGroupId: 'RCP0042',
        },
      },
    );
    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Classic Cheesecake',
        version: 2,
        versionGroupId: 'RCP0042',
        parentRecipeId: 'recipe-v1',
      }),
    );
  });

  it('rejects a new recipe when the name already exists', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.exists.mockResolvedValueOnce({ _id: 'existing-recipe' });

    await expect(
      service.create({
        name: 'Classic Cheesecake',
        category: 'Dessert',
        ingredients: [],
      }),
    ).rejects.toThrow(
      'A recipe with this name already exists. Please use a different name.',
    );
    expect(recipeModel.create).not.toHaveBeenCalled();
  });

  it('creates a corporate chef recipe as approved for the selected site', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({ _id: 'recipe-corporate', ...payload }),
    );

    await service.create(
      {
        site: 'SITE-002',
        name: 'Corporate Recipe',
        category: 'Main Course',
        ingredients: [],
      },
      {
        id: 'corporate-chef-a',
        name: 'Corporate Chef A',
        email: 'corporate@example.com',
        roles: [AppRole.CorporateChef],
        site: 'SITE-002',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        site: 'SITE-002',
        status: 'active',
        approvalStatus: 'approved',
        reviewedBy: 'corporate-chef-a',
        reviewedAt: expect.any(Date),
      }),
    );
  });

  it('stores a corporate chef recipe as a private draft when requested', async () => {
    const { notifications, recipeModel, service, workflowMail } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({ _id: 'corporate-draft', ...payload }),
    );

    await service.create(
      {
        site: 'SITE-002',
        name: 'Corporate Draft',
        category: 'Main Course',
        ingredients: [],
        saveAsDraft: true,
      },
      {
        id: 'corporate-chef-a',
        roles: [AppRole.CorporateChef],
        site: 'SITE-002',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        site: 'SITE-002',
        status: 'draft',
        approvalStatus: 'pending',
        isDraft: true,
      }),
    );
    const createCalls = recipeModel.create.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const payload = createCalls[0]?.[0] ?? {};
    expect(payload.reviewedAt).toBeUndefined();
    expect(payload.reviewedBy).toBeUndefined();
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
  });

  it('rejects IT raw material outside the selected site scope', async () => {
    const { rawMaterials, recipeModel, service } = makeService();
    rawMaterials.findAvailableNormalizedCodesForSite.mockResolvedValue([]);

    await expect(
      service.create(
        {
          site: 'SITE-002',
          name: 'Corporate Recipe',
          category: 'Main Course',
          ingredients: [
            {
              ingredientType: 'IT',
              productCode: 'IT99999',
              name: 'Unavailable Material',
              unitOfMeasures: 'KG',
              qty: 1,
            },
          ],
        },
        {
          roles: [AppRole.CorporateChef],
          site: 'SITE-002',
          sites: ['SITE-001', 'SITE-002'],
        },
      ),
    ).rejects.toThrow(
      'Raw material IT99999 is not available for site SITE-002.',
    );
    expect(recipeModel.create).not.toHaveBeenCalled();
  });

  it('exposes legacy recipes without version metadata as version 1', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel, [
      {
        _id: 'legacy-recipe',
        recipeCode: 'RCP0099',
        name: 'Legacy Recipe',
        status: 'active',
        approvalStatus: 'approved',
      },
    ]);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        version: 1,
        versionGroupId: 'RCP0099',
      }),
    );
  });

  it('scopes pending recipe approvals to the unit manager site', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'pending' }, 'SITE-001');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [{ site: 'SITE-001' }],
      approvalStatus: 'pending',
      deletedAt: { $exists: false },
      isActive: { $ne: false },
      isDraft: { $ne: true },
    });
  });

  it('keeps an empty operational approval scope closed', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);
    await service.findAll({ approvalStatus: 'pending' }, []);
    expect(recipeModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ $and: [{ site: { $in: [] } }] }),
    );
  });

  it('narrows visible recipes by origin site without bypassing visibility', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);
    await service.findAll(
      { siteFilter: 'SITE-002', page: 2, limit: 10 },
      'SITE-001',
    );
    const expected = {
      $and: [
        { $or: [{ approvalStatus: 'approved' }, { site: 'SITE-001' }] },
        { site: 'SITE-002' },
      ],
    };
    expect(recipeModel.find).toHaveBeenCalledWith(
      expect.objectContaining(expected),
    );
    expect(recipeModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining(expected),
    );
  });

  it('filters approved recipes by their origin site', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);
    await service.findAll(
      { siteFilter: 'SITE-002', approvalStatus: 'approved' },
      'SITE-001',
    );
    expect(recipeModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalStatus: 'approved',
        $and: [{ site: 'SITE-002' }],
      }),
    );
  });

  it('lists site options only from visible recipes with site name fallback', async () => {
    const { recipeModel, sites, service } = makeService();
    recipeModel.distinct.mockResolvedValue(['SITE-002', '', 'SITE-001']);
    sites.findSummariesByCodes.mockResolvedValue(
      new Map([['SITE-002', { name: 'Alpha' }]]),
    );
    await expect(service.listSites('SITE-001')).resolves.toEqual([
      { code: 'SITE-002', name: 'Alpha' },
      { code: 'SITE-001', name: 'SITE-001' },
    ]);
    expect(recipeModel.distinct).toHaveBeenCalledWith('site', {
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
      isActive: { $ne: false },
      $or: [{ approvalStatus: 'approved' }, { site: 'SITE-001' }],
    });
  });

  it('includes disabled recipes in superadmin site options', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.distinct.mockResolvedValue([]);
    await service.listSites(undefined, true);
    expect(recipeModel.distinct).toHaveBeenCalledWith('site', {
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
    });
  });

  it('filters pending approvals to several selected sites before pagination', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);
    await service.findAll(
      { approvalStatus: 'pending', strictSite: 'true', page: 2, limit: 10 },
      ['SITE-A', 'CORP'],
    );
    expect(recipeModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalStatus: 'pending',
        $and: [{ site: { $in: ['SITE-A', 'CORP'] } }],
      }),
    );
    expect(recipeModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: [{ site: { $in: ['SITE-A', 'CORP'] } }],
      }),
    );
  });

  it('uses the current corporate approval scope when approving a recipe', async () => {
    const { service, recipeModel } = makeService();
    recipeModel.findOne.mockReturnValue(mockRecipeQuery({ ingredients: [] }));
    recipeModel.findOneAndUpdate.mockReturnValue(
      mockRecipeQuery({ _id: 'recipe-a', site: 'SITE-B' }),
    );
    await service.setApprovalStatus('recipe-a', 'approved', {
      roles: [AppRole.CorporateChef],
      site: 'CORP',
      corporateSite: true,
      approvalSites: ['SITE-A', 'SITE-B'],
      sites: ['OLD-SITE'],
    });
    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'recipe-a',
        approvalStatus: 'pending',
        site: { $in: ['CORP', 'SITE-A', 'SITE-B'] },
        isDraft: { $ne: true },
      },
      expect.any(Object),
      { new: true },
    );
  });

  it('loads draft production recipe references by ID while preserving visibility filters', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);
    const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];

    await service.findAll({ ids: ids.join(',') }, 'SITE-002');

    expect(recipeModel.find).toHaveBeenCalledWith({
      _id: { $in: ids },
      $and: [{ $or: [{ approvalStatus: 'approved' }, { site: 'SITE-002' }] }],
      deletedAt: { $exists: false },
      isActive: { $ne: false },
      isDraft: { $ne: true },
    });
  });

  it('keeps approved recipe data visible across sites', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'approved' }, 'SITE-002');

    expect(recipeModel.find).toHaveBeenCalledWith({
      approvalStatus: 'approved',
      deletedAt: { $exists: false },
      isActive: { $ne: false },
      isDraft: { $ne: true },
    });
  });

  it('shows global approved recipes plus local non-approved recipes by default', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({}, 'SITE-002');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [
        {
          $or: [{ approvalStatus: 'approved' }, { site: 'SITE-002' }],
        },
      ],
      deletedAt: { $exists: false },
      isActive: { $ne: false },
      isDraft: { $ne: true },
    });
  });

  it('limits approval updates to pending recipes in the actor site', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ingredients: [] }),
      }),
    });
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-a' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.setApprovalStatus('recipe-a', 'approved', {
      site: 'SITE-002',
    });

    const updatePayload = getUpdatePayload(recipeModel);

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'recipe-a',
        approvalStatus: 'pending',
        site: 'SITE-002',
        isDraft: { $ne: true },
      },
      expect.any(Object),
      { new: true },
    );
    expect(updatePayload.$set).toEqual(
      expect.objectContaining({
        approvalStatus: 'approved',
        status: 'active',
      }),
    );
  });

  it('records a rejection history entry for the reviewing actor', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-a',
      approvalStatus: 'rejected',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.setApprovalStatus(
      'recipe-a',
      'rejected',
      {
        id: 'manager-a',
        name: 'Manager A',
        email: 'manager@example.com',
        site: 'SITE-002',
      },
      'Adjust the salt quantity.',
    );

    expect(getUpdatePayload(recipeModel).$push).toEqual({
      approvalHistory: expect.objectContaining({
        rejectionReason: 'Adjust the salt quantity.',
        rejectedBy: 'manager-a',
        rejectedByName: 'Manager A',
        rejectedByEmail: 'manager@example.com',
      }),
    });
  });

  it('requires feedback and records it on the matching rejection cycle', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'recipe-a',
        approvalStatus: 'rejected',
        approvalHistory: [
          {
            rejectionReason: 'Adjust the salt quantity.',
            rejectedAt: new Date('2026-08-19T00:00:00.000Z'),
          },
        ],
      }),
    });
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-a',
      approvalStatus: 'pending',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await expect(
      service.resubmitRejectedRecipe('recipe-a', { site: 'SITE-002' }),
    ).rejects.toThrow('Resubmission feedback is required.');

    await service.resubmitRejectedRecipe(
      'recipe-a',
      {
        id: 'chef-a',
        name: 'Chef A',
        email: 'chef@example.com',
        site: 'SITE-002',
      },
      'Reduced salt from 10 g to 7 g.',
    );

    const updatePayload = getUpdatePayload(recipeModel);
    expect(updatePayload.$set).toEqual(
      expect.objectContaining({
        approvalStatus: 'pending',
        'approvalHistory.0.resubmissionFeedback':
          'Reduced salt from 10 g to 7 g.',
        'approvalHistory.0.resubmittedBy': 'chef-a',
      }),
    );
  });

  it('automatically approves a pending recipe edited by a corporate chef', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-a',
      approvalStatus: 'approved',
      status: 'active',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.updateById(
      'recipe-a',
      { name: 'Updated Recipe' },
      {
        id: 'corporate-chef-a',
        name: 'Corporate Chef A',
        email: 'corporate@example.com',
        roles: [AppRole.CorporateChef],
        site: 'SITE-001',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'recipe-a',
        approvalStatus: 'pending',
        site: { $in: ['SITE-001', 'SITE-002'] },
      },
      expect.any(Object),
      { new: true },
    );
    expect(getUpdatePayload(recipeModel).$unset).toMatchObject({
      foodCostRecipe: '',
      'ingredients.$[].foodCost': '',
    });
    expect(getUpdatePayload(recipeModel).$set).toEqual(
      expect.objectContaining({
        name: 'Updated Recipe',
        approvalStatus: 'approved',
        status: 'active',
        reviewedBy: 'corporate-chef-a',
        reviewedByName: 'Corporate Chef A',
        reviewedByEmail: 'corporate@example.com',
        reviewedAt: expect.any(Date),
      }),
    );
  });

  it('keeps a corporate chef draft private while it is being edited', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-draft',
      isDraft: true,
      approvalStatus: 'pending',
      status: 'draft',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.updateById(
      'recipe-draft',
      { name: 'Updated Draft', saveAsDraft: true },
      {
        id: 'corporate-chef-a',
        roles: [AppRole.CorporateChef],
        site: 'SITE-001',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'recipe-draft',
        isDraft: true,
        createdBy: 'corporate-chef-a',
        site: { $in: ['SITE-001', 'SITE-002'] },
      },
      expect.any(Object),
      { new: true },
    );
    const update = getUpdatePayload(recipeModel).$set;
    expect(update.name).toBe('Updated Draft');
    expect(update.approvalStatus).toBeUndefined();
    expect(update.status).toBeUndefined();
    expect(update.reviewedAt).toBeUndefined();
  });

  it('activates a corporate chef draft without notifying approvers', async () => {
    const { notifications, recipeModel, service, workflowMail } = makeService();
    recipeModel.findOne.mockReturnValue(
      mockRecipeQuery({
        _id: 'recipe-draft',
        name: 'Ready Recipe',
        category: 'Main Course',
        ingredients: [estimatedIngredient],
      }),
    );
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-draft',
      name: 'Ready Recipe',
      category: 'Main Course',
      ingredients: [{ name: 'Ingredient' }],
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.submitDraft('recipe-draft', {
      id: 'corporate-chef-a',
      name: 'Corporate Chef A',
      roles: [AppRole.CorporateChef],
      site: 'SITE-001',
      sites: ['SITE-001', 'SITE-002'],
    });

    expect(getUpdatePayload(recipeModel).$unset?.foodCostRecipe).toBe('');
    expect(
      getUpdatePayload(recipeModel).$set.ingredients?.[0].foodCost,
    ).toBeUndefined();
    expect(getUpdatePayload(recipeModel).$set).toEqual(
      expect.objectContaining({
        isDraft: false,
        approvalStatus: 'approved',
        status: 'active',
        reviewedBy: 'corporate-chef-a',
        reviewedAt: expect.any(Date),
      }),
    );
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
  });

  it('does not allow a corporate chef without an assigned site to edit recipes', async () => {
    const { recipeModel, service } = makeService();

    await expect(
      service.updateById(
        'recipe-a',
        { name: 'Updated Recipe' },
        { roles: [AppRole.CorporateChef] },
      ),
    ).rejects.toThrow(
      'Corporate Chef must be assigned to a site before editing recipes.',
    );
    expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('saves the selected vendor using its site price instead of the master or submitted price', async () => {
    const { rawMaterials, recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue(mockRecipeQuery({ site: 'SITE-A' }));
    recipeModel.findOneAndUpdate.mockReturnValue(
      mockRecipeQuery({ _id: 'recipe-a' }),
    );
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
      { productCodeNormalized: 'rm-001', price: 100 },
    ]);
    rawMaterials.findVendorPrices.mockResolvedValue([
      { vendor: 'Vendor A', unitOfMeasures: 'KG', price: 10 },
      { vendor: 'Vendor B', unitOfMeasures: 'KG', price: 20 },
    ]);

    await service.updateById('recipe-a', {
      ingredients: [
        {
          ingredientType: 'IT',
          productCode: 'RM-001',
          name: 'Chicken',
          unitOfMeasures: 'KG',
          qty: 2,
          vendor: 'Vendor A',
          priceUom: 999,
          foodCost: 1998,
        },
      ],
    });

    expect(rawMaterials.findVendorPrices).toHaveBeenCalledWith({
      productCode: 'RM-001',
      site: 'SITE-A',
    });
    expect(getUpdatedIngredient(recipeModel)).toEqual(
      expect.objectContaining({
        vendor: 'Vendor A',
        priceUom: 10,
        foodCost: 20,
      }),
    );
  });

  it('persists the reference source and validates ingredients at the corporate owner site', async () => {
    const { rawMaterials, recipeModel, service, sites } = makeService();
    sites.findSummariesByCodes.mockResolvedValue(
      new Map([['CORP', { materialSource: 'reference' }]]),
    );
    recipeModel.findOne.mockReturnValue(mockRecipeQuery({ site: 'CORP' }));
    recipeModel.findOneAndUpdate.mockReturnValue(
      mockRecipeQuery({ _id: 'recipe-a' }),
    );
    rawMaterials.findAvailableNormalizedCodesForSite.mockResolvedValue([
      'it001',
    ]);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
      { productCodeNormalized: 'it001', price: 999 },
    ]);
    rawMaterials.findVendorPrices.mockResolvedValue([
      {
        vendor: 'Vendor A',
        unitOfMeasures: 'KG',
        price: 10,
        priceSourceSite: 'SITE-B',
        priceSourceSiteName: 'Jakarta B',
      },
    ]);
    await service.updateById('recipe-a', {
      ingredients: [
        {
          ingredientType: 'IT',
          productCode: 'IT001',
          name: 'Chicken',
          unitOfMeasures: 'KG',
          qty: 2,
          vendor: 'Vendor A',
          priceUom: 999,
        },
      ],
    });
    expect(
      rawMaterials.findAvailableNormalizedCodesForSite,
    ).toHaveBeenCalledWith(['IT001'], 'CORP');
    expect(getUpdatedIngredient(recipeModel)).toEqual(
      expect.objectContaining({
        priceUom: 10,
        foodCost: 20,
        priceSourceSite: 'SITE-B',
        priceSourceSiteName: 'Jakarta B',
      }),
    );
  });

  it('does not use a master price when a reference ingredient has no vendor', async () => {
    const { rawMaterials, recipeModel, service, sites } = makeService();
    sites.findSummariesByCodes.mockResolvedValue(
      new Map([['CORP', { materialSource: 'reference' }]]),
    );
    recipeModel.findOne.mockReturnValue(mockRecipeQuery({ site: 'CORP' }));
    rawMaterials.findAvailableNormalizedCodesForSite.mockResolvedValue([
      'it001',
    ]);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
      { productCodeNormalized: 'it001', price: 999 },
    ]);
    await expect(
      service.updateById('recipe-a', {
        ingredients: [
          {
            ingredientType: 'IT',
            productCode: 'IT001',
            name: 'Chicken',
            unitOfMeasures: 'KG',
            qty: 2,
          },
        ],
      }),
    ).rejects.toThrow('Select a reference vendor');
    expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { vendor: 'Another vendor', unitOfMeasures: 'KG', price: 10 },
    { vendor: 'Vendor A', unitOfMeasures: 'BOX', price: 10 },
    { vendor: 'Vendor A', unitOfMeasures: 'KG', price: undefined },
  ])(
    'rejects an unavailable vendor price or incompatible unit: %j',
    async (option) => {
      const { rawMaterials, recipeModel, service } = makeService();
      recipeModel.findOne.mockReturnValue(mockRecipeQuery({ site: 'SITE-A' }));
      rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
        { productCodeNormalized: 'rm-001', price: 100 },
      ]);
      rawMaterials.findVendorPrices.mockResolvedValue([option]);

      await expect(
        service.updateById('recipe-a', {
          ingredients: [
            {
              ingredientType: 'IT',
              productCode: 'RM-001',
              name: 'Chicken',
              unitOfMeasures: 'KG',
              qty: 2,
              vendor: 'Vendor A',
            },
          ],
        }),
      ).rejects.toThrow('has no valid price for this site and unit');
      expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('syncs selected vendor prices within each recipe site and reuses product lookups', async () => {
    const { rawMaterials, recipeModel, service } = makeService();
    const ingredient = {
      ingredientType: 'IT',
      productCode: 'RM-001',
      name: 'Chicken',
      unitOfMeasures: 'KG',
      qty: 2,
      vendor: 'Vendor A',
      priceUom: 1,
      foodCost: 2,
    };
    recipeModel.find.mockReturnValue(
      mockRecipeQuery([
        {
          _id: 'recipe-a',
          site: 'SITE-A',
          ingredients: [ingredient, ingredient],
        },
        { _id: 'recipe-b', site: 'SITE-B', ingredients: [ingredient] },
      ]),
    );
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
      { productCodeNormalized: 'rm-001', price: 100 },
    ]);
    rawMaterials.findVendorPrices.mockImplementation(
      ({ site }: { site: string }) =>
        Promise.resolve([
          {
            vendor: 'Vendor A',
            unitOfMeasures: 'KG',
            price: site === 'SITE-A' ? 10 : 20,
          },
        ]),
    );

    await service.backfillApprovedIngredientCosts();

    expect(rawMaterials.findVendorPrices).toHaveBeenCalledTimes(2);
    const updates = recipeModel.updateOne.mock.calls as unknown as Array<
      [{ _id: string }, RecipeUpdatePayload]
    >;
    expect(updates[0]?.[0]).toEqual({ _id: 'recipe-a' });
    expect(updates[0]?.[1].$set).toMatchObject({
      ingredients: [
        { vendor: 'Vendor A', priceUom: 10 },
        { vendor: 'Vendor A', priceUom: 10 },
      ],
    });
    expect(updates[1]?.[0]).toEqual({ _id: 'recipe-b' });
    expect(updates[1]?.[1].$set).toMatchObject({
      ingredients: [{ vendor: 'Vendor A', priceUom: 20 }],
    });
    for (const [, update] of updates) {
      expect(update.$set.foodCostRecipe).toBeUndefined();
      expect(
        update.$set.ingredients?.every(
          (ingredient) => ingredient.foodCost === undefined,
        ),
      ).toBe(true);
      expect(update.$unset?.foodCostRecipe).toBe('');
    }
  });

  describe('recipe conversion sync', () => {
    const ingredient = {
      productCode: 'RM-001',
      name: 'Ingredient A',
      unitOfMeasures: 'PK',
      prodUomCode: 'GR',
      prodQty: 3000,
      srUomCode: 'PK',
      srQty: 0.6,
      qty: 0.6,
      conversionId: 'GR To PK',
      conversionMultiplier: 1 / 5000,
      priceUom: 90000,
      foodCost: 54000,
    };

    const setup = (ingredients = [ingredient]) => {
      const mocks = makeService();
      mocks.recipeModel.find.mockReturnValue(
        mockRecipeQuery([
          { _id: 'recipe-a', approvalStatus: 'approved', ingredients },
        ]),
      );
      mocks.recipeModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mocks.rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        productCodeNormalized: 'rm-001',
        unitOfMeasures: 'PK',
        specificConversions: [
          { prodUomCode: 'GR', srUomCode: 'PK', conversionFactor: 15000 },
        ],
      });
      return mocks;
    };

    it('recalculates from production quantity with the current product rule and invalidates old estimates', async () => {
      const { service, recipeModel, unitOfMeasures } = setup();
      const result = await service.syncIngredientConversions();
      expect(result).toMatchObject({
        updatedRecipes: 1,
        updatedIngredients: 1,
      });
      expect(recipeModel.find).toHaveBeenCalledWith({
        deletedAt: { $exists: false },
        approvalStatus: { $in: ['approved', 'pending', 'rejected'] },
        isDraft: { $ne: true },
        'ingredients.0': { $exists: true },
      });
      expect(recipeModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'recipe-a', ingredients: [ingredient] }),
        expect.objectContaining({
          $unset: { foodCostRecipe: '' },
        }),
      );
      const calls = recipeModel.updateOne.mock.calls as unknown as Array<
        [unknown, RecipeUpdatePayload]
      >;
      expect(calls[0][1].$set.ingredients?.[0]).toMatchObject({
        prodQty: 3000,
        qty: 0.2,
        srQty: 0.2,
        conversionMultiplier: 1 / 15000,
        priceUom: 90000,
      });
      expect(calls[0][1].$set.ingredients?.[0].foodCost).toBeUndefined();
      expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    });

    it.each(['pending', 'rejected'])(
      'syncs %s recipes and recalculates their approval estimates without changing status',
      async (approvalStatus) => {
        const { service, recipeModel } = setup();
        recipeModel.find.mockReturnValue(
          mockRecipeQuery([
            { _id: 'recipe-a', approvalStatus, ingredients: [ingredient] },
          ]),
        );
        expect(await service.syncIngredientConversions()).toMatchObject({
          updatedRecipes: 1,
          updatedIngredients: 1,
        });
        const calls = recipeModel.updateOne.mock.calls as unknown as Array<
          [Record<string, unknown>, RecipeUpdatePayload]
        >;
        expect(calls[0][0].approvalStatus).toBe(approvalStatus);
        expect(calls[0][1].$set.ingredients?.[0]).toMatchObject({
          prodQty: 3000,
          qty: 0.2,
          srQty: 0.2,
          foodCost: 18000,
        });
        expect(calls[0][1].$set.foodCostRecipe).toBe(18000);
        expect(calls[0][1].$set.approvalStatus).toBeUndefined();
        expect(calls[0][1].$unset).toBeUndefined();
      },
    );

    it('does not compound conversions or write unchanged quantities on repeat sync', async () => {
      const { service, recipeModel } = setup([
        {
          ...ingredient,
          qty: 0.2,
          srQty: 0.2,
          conversionMultiplier: 1 / 15000,
        },
      ]);
      expect(await service.syncIngredientConversions()).toMatchObject({
        updatedRecipes: 0,
        updatedIngredients: 0,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
    });

    it('preserves manual quantities and skips legacy ingredients without production quantity', async () => {
      const { service, recipeModel } = setup();
      recipeModel.find.mockReturnValue(
        mockRecipeQuery([
          {
            _id: 'recipe-a',
            ingredients: [
              { ...ingredient, srQtyManual: true },
              { ...ingredient, prodQty: undefined },
            ],
          },
        ]),
      );
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedManual: 1,
        skippedIncomplete: 1,
        updatedRecipes: 0,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
    });

    it('uses an active global conversion when no product rule exists', async () => {
      const { service, recipeModel, rawMaterials, unitOfMeasures } = setup();
      rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        unitOfMeasures: 'PK',
      });
      unitOfMeasures.findActiveConversion.mockResolvedValue({
        prodUomCode: 'GR',
        srUomCode: 'PK',
        conversionId: 'GR To PK',
        multiplier: 1 / 15000,
      });
      expect(await service.syncIngredientConversions()).toMatchObject({
        updatedRecipes: 1,
      });
      expect(recipeModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('reports missing conversion rules without changing the ingredient', async () => {
      const { service, recipeModel, rawMaterials } = setup();
      rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        unitOfMeasures: 'PK',
      });
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedMissingConversion: 1,
        updatedRecipes: 0,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
    });

    it('reports missing raw materials and does not swallow database failures', async () => {
      const { service, rawMaterials, recipeModel } = setup();
      rawMaterials.findLookupByNormalizedCode.mockResolvedValue(null);
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedIncomplete: 1,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
      rawMaterials.findLookupByNormalizedCode.mockRejectedValue(
        new Error('Lookup failed'),
      );
      await expect(service.syncIngredientConversions()).rejects.toThrow(
        'Lookup failed',
      );
    });

    it('reports concurrent edits instead of counting an unapplied update', async () => {
      const { service, recipeModel } = setup();
      recipeModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedConcurrentRecipes: 1,
        updatedRecipes: 0,
        updatedIngredients: 0,
      });
    });
  });

  it('uses raw material specific conversion when no global conversion exists', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const rawMaterial = {
      productCode: 'RM-001',
      productCodeNormalized: 'rm-001',
      name: 'Saus Tiram',
      unitOfMeasures: 'GAL',
      baseUnitOfMeasures: 'ML',
      conversionFactor: 2200,
      price: 10,
    };
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-a' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });
    unitOfMeasures.findActiveConversion.mockResolvedValue(null);
    rawMaterials.findLookupByNormalizedCode.mockResolvedValue(rawMaterial);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([rawMaterial]);

    await service.updateById('recipe-a', {
      ingredients: [
        {
          productCode: 'RM-001',
          name: 'Saus Tiram',
          unitOfMeasures: 'gal',
          qty: 2,
          prodQty: 4400,
          prodUomCode: 'ml',
          srUomCode: 'gal',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(rawMaterials.findLookupByNormalizedCode).toHaveBeenCalledWith(
      'rm-001',
    );
    expect(ingredient).toEqual(
      expect.objectContaining({
        productCode: 'RM-001',
        name: 'Saus Tiram',
        unitOfMeasures: 'GAL',
        qty: 2,
        prodQty: 4400,
        prodUomCode: 'ML',
        srQty: 2,
        srUomCode: 'GAL',
        conversionId: 'ML To GAL',
        priceUom: 10,
        foodCost: 20,
      }),
    );
    expect(Number(ingredient.conversionMultiplier)).toBeCloseTo(1 / 2200);
  });

  it('prioritizes raw material specific conversion over global conversion', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const rawMaterial = {
      productCode: 'RM-002',
      productCodeNormalized: 'rm-002',
      name: 'Saus Tiram Premium',
      unitOfMeasures: 'GAL',
      baseUnitOfMeasures: 'ML',
      conversionFactor: 450,
      price: 10,
    };
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-b' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });
    unitOfMeasures.findActiveConversion.mockResolvedValue({
      prodUomCode: 'ML',
      srUomCode: 'GAL',
      conversionId: 'ML To GAL',
      multiplier: 1 / 1000,
    });
    rawMaterials.findLookupByNormalizedCode.mockResolvedValue(rawMaterial);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([rawMaterial]);

    await service.updateById('recipe-b', {
      ingredients: [
        {
          productCode: 'RM-002',
          name: 'Saus Tiram Premium',
          unitOfMeasures: 'GAL',
          qty: 1,
          prodQty: 900,
          prodUomCode: 'ML',
          srUomCode: 'GAL',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(ingredient).toEqual(
      expect.objectContaining({
        qty: 2,
        srQty: 2,
        conversionId: 'ML To GAL',
      }),
    );
    expect(Number(ingredient.conversionMultiplier)).toBeCloseTo(1 / 450);
  });

  it('accepts a required manual SR quantity when no conversion is configured', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-manual' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.updateById('recipe-manual', {
      ingredients: [
        {
          productCode: 'RM-MANUAL',
          name: 'Manual Ingredient',
          unitOfMeasures: 'L',
          qty: 2.5,
          prodQty: 1700,
          prodUomCode: 'GR',
          srQty: 2.5,
          srQtyManual: true,
          srUomCode: 'L',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(rawMaterials.findLookupByNormalizedCode).not.toHaveBeenCalled();
    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(ingredient).toEqual(
      expect.objectContaining({
        qty: 2.5,
        prodQty: 1700,
        prodUomCode: 'GR',
        srQty: 2.5,
        srQtyManual: true,
        srUomCode: 'L',
      }),
    );
    expect(ingredient.conversionId).toBeUndefined();
    expect(ingredient.conversionMultiplier).toBeUndefined();
  });

  it('selects the matching rule when a raw material has multiple specific conversions', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const rawMaterial = {
      productCode: 'RM-003',
      productCodeNormalized: 'rm-003',
      name: 'Cooking Oil',
      unitOfMeasures: 'L',
      specificConversions: [
        {
          prodUomCode: 'ML',
          srUomCode: 'KG',
          conversionFactor: 900,
        },
        {
          prodUomCode: 'GR',
          srUomCode: 'L',
          conversionFactor: 850,
        },
      ],
      price: 20,
    };
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-c' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });
    unitOfMeasures.findActiveConversion.mockResolvedValue(null);
    rawMaterials.findLookupByNormalizedCode.mockResolvedValue(rawMaterial);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([rawMaterial]);

    await service.updateById('recipe-c', {
      ingredients: [
        {
          productCode: 'RM-003',
          name: 'Cooking Oil',
          unitOfMeasures: 'L',
          qty: 2,
          prodQty: 1700,
          prodUomCode: 'GR',
          srUomCode: 'L',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(ingredient).toEqual(
      expect.objectContaining({
        qty: 2,
        prodQty: 1700,
        prodUomCode: 'GR',
        srQty: 2,
        srUomCode: 'L',
        conversionId: 'GR To L',
      }),
    );
    expect(Number(ingredient.conversionMultiplier)).toBeCloseTo(1 / 850);
  });
});
