import { AttributeDefinition, Product } from "@pim-connector/core";
import pLimit from "p-limit";
import { AkeneoClient } from "../client/akeneo.client.js";
import { AkeneoMapper } from "../mappers/akeneo.mapper.js";
import { AkeneoProduct, AkeneoProductModel } from "../types/akeneo.types.js";
import { formatAkeneoDate } from "../utils/akeneo.utils.js";

/**
 * Service for handling Akeneo product data operations.
 * Orchestrates fetching, variant resolution, and mapping to CDM.
 */
export class AkeneoProductService {
  private attributeDefinitions: Map<string, AttributeDefinition> = new Map();
  private familyMappings: Map<string, { labelAttribute: string; imageAttribute: string | null }> =
    new Map();

  constructor(
    private client: AkeneoClient,
    private mapper: AkeneoMapper,
  ) {}

  /**
   * Sets family mappings required for product processing.
   */
  setFamilyMappings(
    mappings: Map<string, { labelAttribute: string; imageAttribute: string | null }>,
  ) {
    this.familyMappings = mappings;
  }

  /**
   * Fetches all products across all families.
   */
  async getAllProducts(): Promise<Product[]> {
    if (this.familyMappings.size === 0) {
      return [];
    }

    this.client.clearCaches();

    const limit = pLimit(5);
    const tasks = Array.from(this.familyMappings.entries()).map(([familyCode, familyMapping]) => {
      return limit(async () => {
        const searchFilter = {
          family: [{ operator: "IN" as const, value: [familyCode] }],
        };
        return this.fetchProcessProducts(familyCode, familyMapping, searchFilter);
      });
    });

    const results = await Promise.all(tasks);
    return results.flat();
  }

  /**
   * Fetches products updated since a specific date.
   */
  async getUpdatedProducts(since: Date): Promise<Product[]> {
    if (this.familyMappings.size === 0) {
      return [];
    }

    const limit = pLimit(5);
    const tasks = Array.from(this.familyMappings.entries()).map(([familyCode, familyMapping]) => {
      return limit(async () => {
        const searchFilter = {
          family: [{ operator: "IN" as const, value: [familyCode] }],
          updated: [{ operator: ">" as const, value: formatAkeneoDate(since) }],
        };
        return this.fetchProcessProducts(familyCode, familyMapping, searchFilter);
      });
    });

    const results = await Promise.all(tasks);
    return results.flat();
  }

  /**
   * Fetches a single product by ID.
   */
  async getProduct(id: string): Promise<Product | null> {
    try {
      const akeneoProduct = await this.client.request<AkeneoProduct>({
        url: `/api/rest/v1/products/${id}`,
        method: "GET",
      });

      const familyMapping = akeneoProduct.family
        ? this.familyMappings.get(akeneoProduct.family)
        : undefined;

      return this.mapper.mapToProduct(akeneoProduct, familyMapping);
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper to fetch and process products for a specific family and search filter.
   */
  private async fetchProcessProducts(
    familyCode: string,
    familyMapping: { labelAttribute: string; imageAttribute: string | null },
    searchFilter: Record<string, any>,
  ): Promise<Product[]> {
    const products: Product[] = [];
    try {
      const productBatchIterator = this.client.paginate<AkeneoProduct>("/api/rest/v1/products", {
        search: JSON.stringify(searchFilter),
      });

      const variantProductsByParentId = new Map<string, AkeneoProduct[]>();

      for await (const productBatch of productBatchIterator) {
        for (const akeneoProduct of productBatch) {
          if (akeneoProduct.parent) {
            const parentId = akeneoProduct.parent;
            if (!variantProductsByParentId.has(parentId)) {
              variantProductsByParentId.set(parentId, []);
            }
            variantProductsByParentId.get(parentId)!.push(akeneoProduct);
            continue;
          }

          products.push(this.mapper.mapToProduct(akeneoProduct, familyMapping));
        }
      }

      if (variantProductsByParentId.size > 0) {
        const variantProductsByRootModelCode = new Map<string, AkeneoProduct[]>();

        for (const [parentId, variants] of variantProductsByParentId) {
          let productModel = await this.client.getProductModel(parentId);
          if (!productModel) continue;

          productModel = await this.getRootProductModel(productModel);
          if (!productModel) continue;

          if (!variantProductsByRootModelCode.has(productModel.code)) {
            variantProductsByRootModelCode.set(productModel.code, []);
          }
          variantProductsByRootModelCode.get(productModel.code)!.push(...variants);
        }

        for (const [rootModelCode, variants] of variantProductsByRootModelCode) {
          const productModel = await this.client.getProductModel(rootModelCode);
          if (!productModel) continue;

          const familyVariant = await this.client.getFamilyVariant(
            productModel.family,
            productModel.family_variant,
          );
          if (!familyVariant) continue;

          const product = this.mapper.mapVariantsToProduct(
            productModel,
            familyVariant,
            variants,
            familyMapping,
          );

          if (product) {
            products.push(product);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to fetch products for family ${familyCode}:`, error);
    }
    return products;
  }

  /**
   * Recursively finds the root product model for a given model.
   */
  private async getRootProductModel(
    productModel: AkeneoProductModel,
    visited = new Set<string>(),
  ): Promise<AkeneoProductModel | null> {
    if (!productModel) return null;

    if (visited.has(productModel.code)) return productModel;
    visited.add(productModel.code);

    if (productModel.parent) {
      const parentModel = await this.client.getProductModel(productModel.parent);
      if (!parentModel) return productModel;
      return this.getRootProductModel(parentModel, visited);
    }

    return productModel;
  }
}
