import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FeatureFlag,
  FeatureFlagDocument,
} from './schemas/feature-flag.schema';

const INVENTORY_FEATURE_KEY = 'inventory';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectModel(FeatureFlag.name)
    private readonly featureFlagModel: Model<FeatureFlagDocument>,
  ) {}

  async getInventory() {
    const featureFlag = await this.featureFlagModel
      .findOne({ key: INVENTORY_FEATURE_KEY })
      .lean();

    return {
      key: INVENTORY_FEATURE_KEY,
      enabled: featureFlag?.enabled ?? true,
    };
  }

  async setInventory(enabled: boolean) {
    const featureFlag = await this.featureFlagModel
      .findOneAndUpdate(
        { key: INVENTORY_FEATURE_KEY },
        { $set: { enabled } },
        { new: true, setDefaultsOnInsert: true, upsert: true },
      )
      .lean();

    return {
      key: INVENTORY_FEATURE_KEY,
      enabled: featureFlag?.enabled ?? enabled,
    };
  }
}
