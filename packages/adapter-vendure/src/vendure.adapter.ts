import { GraphQLClient } from 'graphql-request';
import { TargetAdapter, Product, Asset } from '@pim-connector/core';
import { VendureConfig, GET_PRODUCT_BY_SKU, CREATE_PRODUCT, UPDATE_PRODUCT, CREATE_PRODUCT_VARIANTS, UPDATE_PRODUCT_VARIANTS } from './vendure.types.js';
import { VendureMapper } from './vendure.mapper.js';

export class VendureAdapter implements TargetAdapter {
  readonly name = 'vendure';
  private client: GraphQLClient;
  private mapper: VendureMapper;

  constructor(private config: VendureConfig) {
    this.client = new GraphQLClient(config.url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });
    this.mapper = new VendureMapper();
  }

  async initialize(): Promise<void> {
    console.log('Vendure Adapter initialized');
  }

  async upsertProduct(product: Product): Promise<void> {
    const existingProduct = await this.findProductBySku(product.sku);

    let productId: string;
    if (existingProduct) {
      console.log(`Updating existing product ${product.sku} (ID: ${existingProduct.id})`);
      const updateInput = this.mapper.mapToUpdateProductInput(existingProduct.id, product);
      await this.client.request(UPDATE_PRODUCT, { input: updateInput });
      productId = existingProduct.id;
    } else {
      console.log(`Creating new product ${product.sku}`);
      const createInput = this.mapper.mapToCreateProductInput(product);
      const resp = await this.client.request<{ createProduct: { id: string } }>(CREATE_PRODUCT, { input: createInput });
      productId = resp.createProduct.id;
    }

    // Handle Variants
    if (product.variants && product.variants.length > 0) {
      await this.upsertVariants(productId, product.variants, existingProduct?.variants);
    }
  }

  private async findProductBySku(sku: string): Promise<any | null> {
    try {
      const resp = await this.client.request<{ products: { items: any[] } }>(GET_PRODUCT_BY_SKU, { sku });
      return resp.products.items[0] || null;
    } catch (error) {
      console.error(`Error finding product by SKU ${sku}:`, error);
      return null;
    }
  }

  private async upsertVariants(productId: string, variants: any[], existingVariants: any[] = []): Promise<void> {
    const toCreate = [];
    const toUpdate = [];

    for (const variant of variants) {
      const existing = existingVariants.find((v) => v.sku === variant.sku);
      if (existing) {
        toUpdate.push(this.mapper.mapToUpdateVariantInput(existing.id, variant));
      } else {
        toCreate.push(this.mapper.mapToCreateVariantInput(productId, variant));
      }
    }

    if (toCreate.length > 0) {
      await this.client.request(CREATE_PRODUCT_VARIANTS, { input: toCreate });
    }
    if (toUpdate.length > 0) {
      await this.client.request(UPDATE_PRODUCT_VARIANTS, { input: toUpdate });
    }
  }

  async upsertAsset(asset: Asset): Promise<void> {
    console.log(`Upserting asset ${asset.url} to Vendure... (Not fully implemented)`);
    // TODO: Implement asset upload via Admin API
  }
}
