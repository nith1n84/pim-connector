import {
  BasicLogger,
  Category,
  IdentityMap,
  Product,
  TargetAdapter,
} from "@pim-connector/core";
import { VendureConfig } from "./types/vendure.types.js";
import { VendureMapper } from "./mappers/vendure.mapper.js";
import { VendureClient } from "./client/vendure.client.js";
import { VendureCollectionService } from "./services/vendure-collection.service.js";
import { VendureProductService } from "./services/vendure-product.service.js";
import { VendureOptionService } from "./services/vendure-option.service.js";
import { VendureVariantService } from "./services/vendure-variant.service.js";

/**
 * Orchestrator adapter for Vendure Commerce.
 * Delegates specific operations to modular services for better scalability.
 */
export class VendureAdapter implements TargetAdapter {
  readonly name = "vendure";
  private readonly client: VendureClient;
  private readonly mapper: VendureMapper;
  private readonly logger = new BasicLogger("VEN", process.env.LOG_LEVEL);

  // Services
  private collectionService: VendureCollectionService;
  private productService: VendureProductService;
  private categoryIdentityMap: IdentityMap;
  private assetIdentityMap: IdentityMap;

  constructor(private readonly config: VendureConfig) {
    this.client = new VendureClient(config, this.logger);
    this.mapper = new VendureMapper(config);
    this.categoryIdentityMap = config.categoryIdentityMap;
    this.assetIdentityMap = config.assetIdentityMap;

    // Initialize Services
    this.collectionService = new VendureCollectionService(this.client, this.mapper, this.logger);

    const optionService = new VendureOptionService(this.client, this.config, this.logger);
    const variantService = new VendureVariantService(
      this.client,
      this.mapper,
      this.logger,
      this.syncVariantWithCategory.bind(this),
    );

    this.productService = new VendureProductService(
      this.client,
      this.mapper,
      this.assetIdentityMap,
      optionService,
      variantService,
      this.logger,
    );
  }

  /**
   * Initializes the adapter by authenticating.
   */
  async initialize(): Promise<void> {
    await this.client.authenticate();
    this.logger.info("Vendure Adapter initialized");
  }

  /**
   * Upserts a product and its variants.
   */
  async upsertProduct(product: Product, targetId?: string): Promise<string> {
    return this.productService.upsertProduct(product, targetId);
  }

  /**
   * Upserts a collection (category).
   */
  async upsertCollection(
    category: Category,
    targetId?: string,
    parentCollectionIdMap?: Map<string, string>,
  ): Promise<string> {
    if (targetId) {
      // Direct update for existing identity-mapped collections
      const parentId = category.parentId ? parentCollectionIdMap?.get(category.parentId) : null;
      const input = this.mapper.mapToUpdateCollectionInput(targetId, category, parentId || null);
      const { UPDATE_COLLECTION } = await import("./types/vendure.types.js");
      await this.client.request(UPDATE_COLLECTION, { input });
      return targetId;
    }

    const map = parentCollectionIdMap ?? VendureCollectionService.getGlobalCollectionIdMap();
    return this.collectionService.upsertCollection(category, map);
  }

  /**
   * Synchronizes variants with their associated categories in Vendure.
   */
  private async syncVariantWithCategory(categoryVariantMap: Map<string, string[]>): Promise<void> {
    const { UPDATE_COLLECTION } = await import("./types/vendure.types.js");

    for (const [categoryCode, variantIds] of categoryVariantMap.entries()) {
      const targetCategoryId = this.categoryIdentityMap.getTargetId(categoryCode);
      if (!targetCategoryId) continue;

      const input = {
        id: targetCategoryId,
        filters: [
          {
            code: "variant-id-filter",
            arguments: [
              { name: "variantIds", value: JSON.stringify(variantIds) },
              { name: "combineWithAnd", value: "true" },
            ],
          },
        ],
      };

      await this.client.request(UPDATE_COLLECTION, { input });
    }
  }
}
