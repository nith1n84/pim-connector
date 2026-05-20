import {
  Asset,
  BasicLogger,
  Category,
  Product,
  SourceAdapter,
  TokenStore,
} from "@pim-connector/core";
import { AkeneoClient } from "./client/akeneo.client.js";
import { AkeneoMapper } from "./mappers/akeneo.mapper.js";
import { AkeneoCategoryService } from "./services/akeneo-category.service.js";
import { AkeneoProductService } from "./services/akeneo-product.service.js";
import { AkeneoConfig } from "./types/akeneo.types.js";

/**
 * Adapter for Akeneo PIM.
 * Implements the SourceAdapter interface by delegating to specialized services.
 */
export class AkeneoAdapter implements SourceAdapter {
  readonly name = "akeneo";
  private readonly client: AkeneoClient;
  private readonly mapper: AkeneoMapper;
  private productService: AkeneoProductService;
  private categoryService: AkeneoCategoryService;
  private config: AkeneoConfig;
  logger = new BasicLogger("AKN", process.env.LOG_LEVEL);

  constructor(config: AkeneoConfig, tokenStore?: TokenStore) {
    this.config = config;
    this.client = new AkeneoClient(config, this.logger, tokenStore);
    this.mapper = new AkeneoMapper(config.locales, config.scopes);
    this.productService = new AkeneoProductService(this.client, this.mapper, this.logger);
    this.categoryService = new AkeneoCategoryService(this.client, this.mapper, this.logger);
  }

  /**
   * Initializes the adapter by fetching metadata from Akeneo.
   * Caches attribute definitions, family settings, and option groups.
   */
  async initialize(): Promise<void> {
    this.logger.info(`Akeneo Adapter initialized `);
  }

  async fetchProducts(
    page: number,
    limit: number,
    since?: Date,
    identifiers?: string[],
  ): Promise<Product[]> {
    return this.productService.fetchProducts(page, limit, since, identifiers);
  }

  /**
   * Fetches a single product by ID.
   */
  async getProduct(id: string): Promise<Product | null> {
    return this.productService.getProduct(id);
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
