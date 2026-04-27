import { Asset, AttributeDefinition, Category, Product, SourceAdapter } from "@pim-connector/core";
import { AkeneoClient } from "./client/akeneo.client.js";
import { AkeneoMapper } from "./mappers/akeneo.mapper.js";
import { AkeneoCategoryService } from "./services/akeneo-category.service.js";
import { AkeneoProductService } from "./services/akeneo-product.service.js";
import { AkeneoConfig } from "./types/akeneo.types.js";
import { mapAkeneoTypeToCdmType } from "./utils/akeneo.utils.js";

/**
 * Adapter for Akeneo PIM.
 * Implements the SourceAdapter interface by delegating to specialized services.
 */
export class AkeneoAdapter implements SourceAdapter {
  readonly name = "akeneo";
  private client: AkeneoClient;
  private mapper: AkeneoMapper;
  private productService: AkeneoProductService;
  private categoryService: AkeneoCategoryService;
  private config: AkeneoConfig;

  constructor(config: AkeneoConfig) {
    this.config = config;
    this.client = new AkeneoClient(config);
    this.mapper = new AkeneoMapper(config.locales, config.scopes);
    this.productService = new AkeneoProductService(this.client, this.mapper);
    this.categoryService = new AkeneoCategoryService(this.client, this.mapper);
  }

  /**
   * Initializes the adapter by fetching metadata from Akeneo.
   * Caches attribute definitions, family settings, and option groups.
   */
  async initialize(): Promise<void> {
    console.log("Initializing Akeneo Adapter...");
    const attributeDefinitions: Map<string, AttributeDefinition> = new Map();
    const familyMappings: Map<string, { labelAttribute: string; imageAttribute: string | null }> =
      new Map();

    const rawDefinitions = await this.client.getAttributeDefinitions();
    for (const raw of rawDefinitions) {
      attributeDefinitions.set(raw.code, {
        code: raw.code,
        akeneoType: raw.type,
        cdmType: mapAkeneoTypeToCdmType(raw.type),
        localisable: raw.localizable,
        scopable: raw.scopable,
      });
    }

    const families = await this.client.getFamilies();
    for (const family of families) {
      familyMappings.set(family.code, {
        labelAttribute: family.attribute_as_label || "name",
        imageAttribute: family.attribute_as_image || null,
      });
    }

    const optionGroups = await this.client.getOptionGroups();

    // Configure internal components
    this.mapper.setAttributeDefinitions(attributeDefinitions);
    this.mapper.setFamilyMappings(familyMappings);
    this.mapper.setOptionGroups(optionGroups);

    this.productService.setFamilyMappings(familyMappings);

    console.log(
      `Akeneo Adapter initialized with ${attributeDefinitions.size} attribute definitions and ${familyMappings.size} family mappings`,
    );
  }

  /**
   * Fetches all products from Akeneo.
   */
  async getProducts(): Promise<Product[]> {
    return this.productService.getAllProducts();
  }

  /**
   * Fetches a single product by ID.
   */
  async getProduct(id: string): Promise<Product | null> {
    return this.productService.getProduct(id);
  }

  /**
   * Fetches products updated since a specific date.
   */
  async getUpdatedProducts(since: Date): Promise<Product[]> {
    return this.productService.getUpdatedProducts(since);
  }

  /**
   * Placeholder for asset retrieval.
   */
  async getAssets(): Promise<Asset[]> {
    return [];
  }

  /**
   * Fetches all categories from Akeneo.
   */
  async getCategories(): Promise<Category[]> {
    return this.categoryService.getAllCategories(this.config.categoryRootCode);
  }
}
