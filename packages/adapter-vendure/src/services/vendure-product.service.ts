import { IdentityMap, Logger, Product } from "@pim-connector/core";
import { VendureClient } from "../client/vendure.client.js";
import { VendureMapper } from "../mappers/vendure.mapper.js";
import { VendureOptionService } from "./vendure-option.service.js";
import { VendureVariantService } from "./vendure-variant.service.js";
import {
  CREATE_PRODUCT,
  GET_PRODUCT_BY_ID,
  GET_PRODUCT_BY_VARIANT_SKU,
  UPDATE_PRODUCT,
  VendureProduct,
} from "../types/vendure.types.js";

/**
 * Service for high-level product synchronization in Vendure.
 * Orchestrates product lookups, asset uploads, options, and variants.
 */
export class VendureProductService {
  constructor(
    private readonly client: VendureClient,
    private readonly mapper: VendureMapper,
    private readonly assetIdentityMap: IdentityMap,
    private readonly optionService: VendureOptionService,
    private readonly variantService: VendureVariantService,
    private readonly logger: Logger,
  ) {}

  /**
   * Upserts a product into Vendure.
   */
  async upsertProduct(product: Product, targetId?: string): Promise<string> {
    if (!product.sku) return "";

    const existingProduct = targetId
      ? await this.getProductById(targetId)
      : await this.findProductBySku(product.sku);

    // 1. Process Assets
    const assetIds = await this.processAssets(product);

    // 2. Upsert Core Product
    let productId: string;
    if (existingProduct) {
      const input = this.mapper.mapToUpdateProductInput(existingProduct.id, product, assetIds);
      await this.client.request(UPDATE_PRODUCT, { input });
      productId = existingProduct.id;
      this.logger.debug(`Updated product ${product.sku} (ID: ${productId})`);
    } else {
      const input = this.mapper.mapToCreateProductInput(product, assetIds);
      const resp = await this.client.request<{ createProduct: { id: string } }>(CREATE_PRODUCT, {
        input,
      });
      productId = resp.createProduct.id;
      this.logger.debug(`Created product ${product.sku} (ID: ${productId})`);
    }

    // 3. Handle Options
    if (product.optionGroups && product.optionGroups.length > 0) {
      const { optionGroupMap } = await this.optionService.ensureOptionGroupsExist(
        product.optionGroups,
      );
      await this.optionService.addOptionGroupsToProduct(
        productId,
        Array.from(optionGroupMap.values()),
      );
    }

    // 4. Handle Variants
    await this.processVariants(productId, product, existingProduct);

    return productId;
  }

  private async processAssets(product: Product): Promise<string[]> {
    const assetIds: string[] = [];
    if (!product.assets || product.assets.length === 0) return assetIds;

    for (const file of product.assets) {
      if (file.id && file.name) {
        const existingAssetId = this.assetIdentityMap.getTargetId(file.id);
        if (existingAssetId) {
          assetIds.push(existingAssetId);
        } else if (file.buffer) {
          const result = await this.client.upload(file.buffer, file.name, file.mimeType);
          if (result.length > 0) {
            assetIds.push(result[0]);
            this.assetIdentityMap.setMapping(file.id, result[0]);
          }
        }
      }
    }
    return assetIds;
  }

  private async processVariants(
    productId: string,
    product: Product,
    existingProduct: any,
  ): Promise<void> {
    let variants = product.variants || [];

    // Simple product logic
    if (variants.length === 0) {
      const existing = await this.variantService.getExistingVariants(productId);
      if (existing.length === 0) {
        variants = [this.variantService.createDefaultVariant(product)];
      }
    }

    if (variants.length > 0) {
      await this.variantService.upsertVariants(
        productId,
        variants,
        existingProduct?.variants,
        VendureOptionService.getGlobalOptionIdMap(),
      );
    }
  }

  private async findProductBySku(sku: string): Promise<VendureProduct | null> {
    try {
      const resp = await this.client.request<{
        productVariants: { items: any[] };
      }>(GET_PRODUCT_BY_VARIANT_SKU, { sku });
      return resp.productVariants.items[0]?.product || null;
    } catch (error) {
      this.logger.error(`Error finding product by SKU ${sku}:`, error);
      return null;
    }
  }

  private async getProductById(id: string): Promise<VendureProduct | null> {
    try {
      const resp = await this.client.request<{ product: VendureProduct }>(GET_PRODUCT_BY_ID, {
        id,
      });
      return resp.product || null;
    } catch (error) {
      this.logger.error(`Error finding product by ID ${id}:`, error);
      return null;
    }
  }
}
