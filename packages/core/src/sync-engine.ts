import { Logger, SourceAdapter, TargetAdapter } from "./adapter.interface.js";
import { IdentityMap } from "./identity-map.js";

export interface SyncOptions {
  delayMs?: number;
  dryRun?: boolean;
  batchSize?: number;
  concurrency?: number;
}

export class SyncEngine {
  constructor(
    private source: SourceAdapter,
    private target: TargetAdapter,
    private identityMap: IdentityMap,
    private categoryIdentityMap: IdentityMap,
    private logger: Logger,
    private options: SyncOptions = {},
  ) {}

  /**
   * Processes items in parallel with concurrency control.
   */
  private async processInParallel<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number = 5,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const executing: Array<{ promise: Promise<{ index: number; result: R }>; index: number }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const promise = processor(item).then((result) => ({ index: i, result }));

      executing.push({ promise, index: i });

      if (executing.length >= concurrency) {
        const completed = await Promise.race(executing.map((e) => e.promise));
        results[completed.index] = completed.result;
        // Remove completed promise
        const completedIndex = executing.findIndex((e) => e.index === completed.index);
        if (completedIndex > -1) {
          executing.splice(completedIndex, 1);
        }
      }
    }

    // Wait for remaining promises
    const remainingResults = await Promise.all(executing.map((e) => e.promise));
    for (const { index, result } of remainingResults) {
      results[index] = result;
    }

    return results;
  }

  /**
   * Runs a full synchronization from source to target.
   */
  async runFullSync(): Promise<void> {
    this.logger.info(`Starting full sync from ${this.source.name} to ${this.target.name}`);

    try {
      const batchSize = this.options.batchSize || 10;
      let page = 1;
      let totalProductsSynced = 0;

      while (true) {
        this.logger.info(`Fetching page ${page} with batch size ${batchSize}`);
        const sourceProducts = await this.source.fetchProducts(page, batchSize);

        if (sourceProducts.length === 0) {
          this.logger.info(`No more products found on page ${page}. Stopping sync.`);
          break;
        }

        this.logger.info(`Fetched ${sourceProducts.length} products from page ${page}.`);
        await this.syncProducts(sourceProducts);
        totalProductsSynced += sourceProducts.length;

        page++;
      }

      // Save identity map persistence
      await this.identityMap.save();

      this.logger.info(
        `Full sync completed successfully. Total products synced: ${totalProductsSynced}.`,
      );
    } catch (error) {
      this.logger.error("Full sync failed:", error);
      throw error;
    }
  }

  async runProductSync(): Promise<void> {
    this.logger.info(`Starting product sync from ${this.source.name} to ${this.target.name}`);
  }

  /**
   * Runs an incremental synchronization since the specified date.
   */
  async runIncrementalSync(since: Date): Promise<void> {
    this.logger.info(`Starting incremental sync since ${since.toISOString()}`);

    try {
      if (!this.source.fetchUpdatedProducts) {
        throw new Error(`Source adapter ${this.source.name} does not support incremental sync.`);
      }

      const batchSize = this.options.batchSize || 20;
      let page = 1;
      let totalProductsSynced = 0;

      while (true) {
        this.logger.info(`Fetching updated products page ${page} with batch size ${batchSize}`);
        const updatedProducts = await this.source.fetchUpdatedProducts(page, batchSize, since);

        if (updatedProducts.length === 0) {
          this.logger.info(
            `No more updated products found on page ${page}. Stopping incremental sync.`,
          );
          break;
        }

        this.logger.info(`Fetched ${updatedProducts.length} updated products from page ${page}.`);
        await this.syncProducts(updatedProducts);
        totalProductsSynced += updatedProducts.length;

        page++;
      }

      // Save identity map persistence
      await this.identityMap.save();

      this.logger.info(
        `Incremental sync completed successfully. Total products synced: ${totalProductsSynced}.`,
      );
    } catch (error) {
      this.logger.error("Incremental sync failed:", error);
      throw error;
    }
  }

  /**
   * Runs a category/collection synchronization from source to target.
   */
  async runCategorySync(): Promise<void> {
    this.logger.info(`Starting category sync from ${this.source.name} to ${this.target.name}`);

    try {
      if (!this.source.getCategories || !this.target.upsertCollection) {
        throw new Error(
          `Source or target adapter does not support category sync. Ensure both adapters implement getCategories() and upsertCollection().`,
        );
      }

      const sourceCategories = await this.source.getCategories();
      this.logger.info(`Fetched ${sourceCategories.length} categories from source.`);

      await this.syncCategories(sourceCategories);

      this.logger.info("Category sync completed successfully.");
    } catch (error) {
      this.logger.error("Category sync failed:", error);
      throw error;
    }
  }

  /**
   * Processes a list of source categories through transformation and target upsert.
   */
  private async syncCategories(sourceCategories: any[]): Promise<void> {
    if (sourceCategories.length === 0) return;

    const concurrency = this.options.concurrency || 5;
    this.logger.info(
      `Processing ${sourceCategories.length} categories with concurrency: ${concurrency}`,
    );

    let successCount = 0;
    let errorCount = 0;
    const parentCollectionIdMap = new Map<string, string>();

    // Sort categories to ensure parent categories are processed first
    const sortedCategories = this.sortCategoriesByHierarchy(sourceCategories);

    const processCategory = async (
      sourceCategory: any,
    ): Promise<{ success: boolean; error?: Error; targetId?: string }> => {
      try {
        // Check local identity map
        const sourceId = sourceCategory.id || sourceCategory.code;
        const targetId = this.categoryIdentityMap.getTargetId(sourceId);

        // Log action
        const action = targetId ? "Updating" : "Creating";
        this.logger.info(
          `${this.options.dryRun ? "[DRY-RUN] " : ""}${action} collection: ${sourceCategory.code} (${sourceCategory.name})`,
        );

        if (!this.options.dryRun) {
          const newTargetId = await this.target.upsertCollection(
            sourceCategory,
            targetId,
            parentCollectionIdMap,
          );

          // Track in identity map
          this.categoryIdentityMap.setMapping(sourceId, newTargetId);
          parentCollectionIdMap.set(sourceCategory.code, newTargetId);
          return { success: true, targetId: newTargetId };
        } else {
          this.logger.info(`[DRY-RUN] Skipped sync for ${sourceCategory.code}`);
          return { success: true };
        }
      } catch (error) {
        this.logger.error(`Failed to sync category ${sourceCategory.code}:`, error);
        return { success: false, error: error as Error };
      }
    };

    // Process categories in parallel with concurrency control
    const results = await this.processInParallel(sortedCategories, processCategory, concurrency);

    // Count results
    for (const result of results) {
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    // Save identity map persistence
    await this.categoryIdentityMap.save();

    this.logger.info(`Category sync statistics: ${successCount} succeeded, ${errorCount} failed.`);
  }

  /**
   * Sort categories to ensure parent categories are processed before children.
   */
  private sortCategoriesByHierarchy(categories: any[]): any[] {
    const categoryMap = new Map(categories.map((cat) => [cat.code || cat.id, cat]));
    const sorted: any[] = [];
    const visited = new Set<string>();

    const visit = (category: any) => {
      const code = category.code || category.id;
      if (visited.has(code)) return;

      // Visit parent first
      if (category.parentId) {
        const parent = categoryMap.get(category.parentId);
        if (parent) {
          visit(parent);
        }
      }

      visited.add(code);
      sorted.push(category);
    };

    for (const category of categories) {
      visit(category);
    }

    return sorted;
  }

  /**
   * Processes a list of source products through transformation and target upsert.
   */
  private async syncProducts(sourceProducts: any[]): Promise<void> {
    if (sourceProducts.length === 0) return;

    const concurrency = this.options.concurrency || 5;
    this.logger.info(
      `Processing ${sourceProducts.length} products with concurrency: ${concurrency}`,
    );

    let successCount = 0;
    let errorCount = 0;

    const processProduct = async (
      sourceProduct: any,
    ): Promise<{ success: boolean; error?: Error }> => {
      try {
        // 1. Check local identity map
        const sourceId = sourceProduct.id || sourceProduct.sku;
        const targetId = this.identityMap.getTargetId(sourceId);

        // Log action
        const action = targetId ? "Updating" : "Creating";
        this.logger.info(
          `${this.options.dryRun ? "[DRY-RUN] " : ""}${action} product: ${sourceProduct.sku} ...`,
        );

        if (!this.options.dryRun) {
          const newTargetId = await this.target.upsertProduct(sourceProduct, targetId);

          // Track in identity map
          this.identityMap.setMapping(sourceId, newTargetId);
          return { success: true };
        } else {
          this.logger.info(`[DRY-RUN] Skipped sync for ${sourceProduct.sku}`);
          return { success: true };
        }
      } catch (error) {
        this.logger.error(`Failed to sync product ${sourceProduct.id || "unknown"}:`, error);
        return { success: false, error: error as Error };
      }
    };

    // Process products in parallel with concurrency control
    const results = await this.processInParallel(sourceProducts, processProduct, concurrency);

    // Count results
    for (const result of results) {
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    this.logger.info(`Sync statistics: ${successCount} succeeded, ${errorCount} failed.`);
  }
}
