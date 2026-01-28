import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';

type CreateProductInput = {
  userId: string;
  name: string;
  price: number;
  category?: string;
};

@Injectable()
export class ProductsService {
  constructor(@InjectModel(Product.name) private readonly productModel: Model<ProductDocument>) {}

  async create(input: CreateProductInput) {
    return this.productModel.create(input);
  }

  async createMany(inputs: CreateProductInput[]) {
    if (!inputs.length) return [];
    return this.productModel.insertMany(inputs);
  }

  async findAllByUser(userId: string) {
    return this.productModel.find({ userId }).sort({ createdAt: -1 }).lean();
  }
}
