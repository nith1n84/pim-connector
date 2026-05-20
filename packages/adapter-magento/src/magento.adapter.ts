import { Attribute, AttributeOption, BasicLogger, Category, Family, Product, TargetAdapter } from "@pim-connector/core";
import { MagentoConfig } from "./types/magento.types.js";
import { MagentoClient } from "./client/magento.client.js";
import { MagentoMapper } from "./mappers/magento.mapper.js";
import { MagentoAttributeService } from "./services/magento-attribute.service.js";
import { MagentoMediaService } from "./services/magento-media.service.js";
import { MagentoProductService } from "./services/magento-product.service.js";
import { MagentoCategoryService } from "./services/magento-category.service.js";
import { MagentoSchemaService } from "./services/magento-schema.service.js";

/**
 * Orchestrator adapter for Magento 2.
 *
 * Implements the TargetAdapter interface and delegates operations to
 * focused service classes:
 *  - MagentoProductService  → product + variant upsert, localized fields
 *  - MagentoCategoryService → category tree upsert, localized names
 *  - MagentoAttributeService → attribute set + attribute resolution
 *  - MagentoMediaService    → image upload + identity-map caching
 */
export class MagentoAdapter implements TargetAdapter {
  readonly name = "magento";

  private readonly client: MagentoClient;
  private readonly mapper: MagentoMapper;
  private readonly logger = new BasicLogger("MGT", process.env.LOG_LEVEL);

  private readonly attributeService: MagentoAttributeService;
  private readonly mediaService: MagentoMediaService;
  private readonly productService: MagentoProductService;
  private readonly categoryService: MagentoCategoryService;
  private readonly schemaService: MagentoSchemaService;

  constructor(private readonly config: MagentoConfig) {
    this.client = new MagentoClient(config, this.logger, config.tokenStore);
    this.mapper = new MagentoMapper(config);

    this.attributeService = new MagentoAttributeService(this.client, this.logger);

    this.mediaService = new MagentoMediaService(
      this.client,
      config.assetIdentityMap,
      this.logger,
    );

    this.productService = new MagentoProductService(
      this.client,
      this.mapper,
      this.attributeService,
      this.mediaService,
      config,
      this.logger,
    );

    this.categoryService = new MagentoCategoryService(
      this.client,
      this.mapper,
      config,
      this.logger,
    );

    this.schemaService = new MagentoSchemaService(
      this.client,
      this.attributeService,
      this.logger,
    );
  }

  // ---------------------------------------------------------------------------
  // TargetAdapter interface
  // ---------------------------------------------------------------------------

  /**
   * Authenticates with Magento and loads required metadata.
   */
  async initialize(): Promise<void> {
    await this.client.authenticate();
    this.logger.info("Magento Adapter initialized");
  }

  /**
   * Creates or updates a product and its variants in Magento.
   *
   * @param product - The CDM product from the source adapter.
   * @param targetId - Existing Magento SKU if previously synced (from identity map).
   * @returns The product's SKU, used as the stable identifier.
   */
  async upsertProduct(product: Product, targetId?: string): Promise<string> {
    return this.productService.upsertProduct(product, targetId);
  }

  /**
   * Creates or updates a category in Magento.
   */
  async upsertCollection(
    category: Category,
    targetId?: string,
    parentCollectionIdMap?: Map<string, string>,
  ): Promise<string> {
    return this.categoryService.upsertCategory(category, targetId, parentCollectionIdMap);
  }

  // ---------------------------------------------------------------------------
  // Schema sync — TargetAdapter optional methods
  // ---------------------------------------------------------------------------

  /**
   * Step 3 of sync-schema: Creates or finds a Magento Attribute Set for an Akeneo Family.
   */
  async upsertAttributeSet(family: Family, targetId?: string): Promise<string> {
    return this.schemaService.upsertAttributeSet(family);
  }

  /**
   * Step 1 of sync-schema: Creates or updates a Magento Attribute from an Akeneo Attribute.
   */
  async upsertAttribute(attribute: Attribute, targetId?: string): Promise<string> {
    return this.schemaService.upsertAttribute(attribute);
  }

  /**
   * Step 2 of sync-schema: Creates missing options for a select/multiselect attribute.
   */
  async upsertAttributeOptions(options: AttributeOption[], attributeCode: string): Promise<void> {
    return this.schemaService.upsertAttributeOptions(options, attributeCode);
  }

  /**
   * Step 4 of sync-schema: Assigns attribute codes to a Magento Attribute Set.
   */
  async assignAttributesToSet(attributeSetId: string, attributeCodes: string[]): Promise<void> {
    return this.schemaService.assignAttributesToSet(attributeSetId, attributeCodes);
  }
}
