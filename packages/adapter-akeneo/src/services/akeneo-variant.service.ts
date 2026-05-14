import { Logger } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";
import { AkeneoProduct, AkeneoProductModel } from "../types/akeneo.types.js";

/**
 * Service for managing Akeneo product variants and product models.
 * Handles hierarchy traversal and variant-specific metadata resolution.
 */
export class AkeneoVariantService {
  constructor(
    private readonly client: AkeneoClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Recursively finds the root product model for a given model or child product.
   * @param modelCode - The code of the product model to start traversal from.
   * @returns The root product model or null if not found.
   */
  async getRootProductModel(modelCode: string): Promise<AkeneoProductModel | null> {
    const visited = new Set<string>();

    const traverse = async (code: string): Promise<AkeneoProductModel | null> => {
      if (visited.has(code)) return null;
      visited.add(code);

      const model = await this.client.getProductModel(code);
      if (!model) return null;

      if (model.parent) {
        return traverse(model.parent);
      }

      return model;
    };

    return traverse(modelCode);
  }

  /**
   * Groups child products by their respective root product models.
   * @param products - The list of products (some of which may be variants).
   * @returns A map of root model codes to their descendant products.
   */
  async groupProductsByRootModel(products: AkeneoProduct[]): Promise<Map<string, AkeneoProduct[]>> {
    const groups = new Map<string, AkeneoProduct[]>();

    for (const product of products) {
      if (!product.parent) continue;

      const rootModel = await this.getRootProductModel(product.parent);
      if (!rootModel) {
        this.logger.debug(`Could not resolve root model for product ${product.identifier}`);
        continue;
      }

      const variants = groups.get(rootModel.code) || [];
      variants.push(product);
      groups.set(rootModel.code, variants);
    }

    return groups;
  }
}
