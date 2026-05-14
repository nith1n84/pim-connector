import { Logger, Product, ProductVariant } from "@pim-connector/core";
import { VendureClient } from "../client/vendure.client.js";
import { VendureMapper } from "../mappers/vendure.mapper.js";
import {
  CREATE_PRODUCT_VARIANTS,
  UPDATE_PRODUCT_VARIANTS,
  CreateProductVariantsResponse,
  UpdateProductVariantsResponse,
} from "../types/vendure.types.js";

/**
 * Service for managing Vendure product variants.
 * Handles creation, updates, and synchronization with categories.
 */
export class VendureVariantService {
  constructor(
    private readonly client: VendureClient,
    private readonly mapper: VendureMapper,
    private readonly logger: Logger,
    private readonly syncWithCategory: (associationMap: Map<string, string[]>) => Promise<void>,
  ) {}

  /**
   * Upserts a list of variants for a given product.
   */
  async upsertVariants(
    productId: string,
    variants: any[],
    existingVariants: any[] = [],
    optionIdMap: Map<string, string>,
  ): Promise<void> {
    const toCreate = [];
    const toUpdate = [];

    for (const variant of variants) {
      const existing = existingVariants.find((v) => v.sku === variant.sku);
      if (existing) {
        toUpdate.push(this.mapper.mapToUpdateVariantInput(existing.id, variant, optionIdMap));
      } else {
        toCreate.push(this.mapper.mapToCreateVariantInput(productId, variant, optionIdMap));
      }
    }

    if (toCreate.length > 0) {
      const response = await this.client.request<CreateProductVariantsResponse>(
        CREATE_PRODUCT_VARIANTS,
        { input: toCreate },
      );

      const categoryMap: Map<string, string[]> = new Map();
      const variantBySku = new Map(variants.map((v: ProductVariant) => [v.sku, v]));

      response.createProductVariants.forEach(({ id, sku }) => {
        const variant = variantBySku.get(sku);
        if (variant?.categories) {
          variant.categories.forEach((cat) => {
            const ids = categoryMap.get(cat) || [];
            ids.push(id);
            categoryMap.set(cat, ids);
          });
        }
      });

      if (categoryMap.size > 0) {
        await this.syncWithCategory(categoryMap);
      }
    }

    if (toUpdate.length > 0) {
      await this.client.request<UpdateProductVariantsResponse>(UPDATE_PRODUCT_VARIANTS, {
        input: toUpdate,
      });
    }
  }

  /**
   * Retrieves existing variants for a product.
   */
  async getExistingVariants(productId: string): Promise<any[]> {
    const query = `
      query GetProductVariants($id: ID!) {
        product(id: $id) {
          variants {
            id
            sku
          }
        }
      }
    `;

    try {
      const resp = await this.client.request<{
        product: { variants: Array<{ id: string; sku: string }> };
      }>(query, { id: productId });
      return resp.product?.variants || [];
    } catch (error) {
      this.logger.error(`Error getting variants for product ${productId}:`, error);
      return [];
    }
  }

  /**
   * Creates a default variant for a simple product.
   */
  createDefaultVariant(product: Product): any {
    return {
      id: product.sku || product.id,
      sku: product.sku || product.id,
      name: product.name,
      prices: [{ amount: 0, currency: "AED" }],
      assets: [],
      optionValues: [],
    };
  }
}
