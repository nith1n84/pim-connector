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
   * Runs a product synchronization from source to target.
   */
  async syncProducts(since?: Date): Promise<void> {
    const syncType = since ? "incremental" : "full";
    this.logger.info(
      `Starting ${syncType} product sync from ${this.source.name} to ${this.target.name}${since ? ` since ${since.toISOString()}` : ""}`,
    );

    let successCount = 0;
    let errorCount = 0;

    try {
      const batchSize = this.options.batchSize || 10;
      let page = 1;
      let totalProductsFetched = 0;

      while (true) {
        this.logger.info(`Fetching page ${page} with batch size ${batchSize}`);
        const sourceProducts = await this.source.fetchProducts(page, batchSize, since);

        if (sourceProducts.length === 0) {
          this.logger.info(`No more products found on page ${page}. Stopping sync.`);
          break;
        }

        totalProductsFetched += sourceProducts.length;
        this.logger.info(
          `Fetched ${sourceProducts.length} products (Total fetched: ${totalProductsFetched})`,
        );

        const batchResults = await this.syncProductsInternal(sourceProducts);
        successCount += batchResults.success;
        errorCount += batchResults.error;

        if (totalProductsFetched % 50 === 0) {
          this.logger.info(
            `Progress: ${totalProductsFetched} products processed (${successCount} succeeded, ${errorCount} failed)`,
          );
        }

        page++;
      }

      // Save identity map persistence
      await this.identityMap.save();

      this.logger.info("--------------------------------------------------");
      this.logger.info(`${syncType.charAt(0).toUpperCase() + syncType.slice(1)} sync summary:`);
      this.logger.info(`- Total Products: ${totalProductsFetched}`);
      this.logger.info(`- Succeeded:      ${successCount}`);
      this.logger.info(`- Failed:         ${errorCount}`);
      this.logger.info("--------------------------------------------------");
    } catch (error) {
      this.logger.error(
        `${syncType.charAt(0).toUpperCase() + syncType.slice(1)} sync failed:`,
        error,
      );
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

      const sortedCategories = this.sortCategoriesByHierarchy(sourceCategories);
      await this.syncCategories(sortedCategories);

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
    let successCount = 0;
    let errorCount = 0;
    const parentCollectionIdMap = new Map<string, string>();

    for (const sourceCategory of sourceCategories) {
      try {
        // Check local identity map
        const sourceId = sourceCategory.id || sourceCategory.code;
        const targetId = this.categoryIdentityMap.getTargetId(sourceId);

        // Log action
        const action = targetId ? "Updating" : "Creating";
        const displayName = this.getDisplayName(sourceCategory.name) || sourceCategory.code;
        this.logger.info(
          `${this.options.dryRun ? "[DRY-RUN] " : ""}${action} collection: ${sourceCategory.code} (${displayName})`,
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
          successCount++;
        } else {
          this.logger.info(`[DRY-RUN] Skipped sync for ${sourceCategory.code}`);
          successCount++;
        }

        // Apply throttle delay if configured
        if (this.options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
        }
      } catch (error) {
        this.logger.error(`Failed to sync category ${sourceCategory.code}:`, error);
        errorCount++;
      }
    }

    // Save identity map persistence
    await this.categoryIdentityMap.save();

    this.logger.info("--------------------------------------------------");
    this.logger.info("Category sync summary:");
    this.logger.info(`- Total Categories: ${sourceCategories.length}`);
    this.logger.info(`- Succeeded:        ${successCount}`);
    this.logger.info(`- Failed:           ${errorCount}`);
    this.logger.info("--------------------------------------------------");
  }

  /**
   * Helper to get a display name from localized strings.
   */
  private getDisplayName(name: any): string | undefined {
    if (typeof name === "string") return name;
    if (!name || typeof name !== "object") return undefined;

    // Try common locales
    return name.en_US || name.en || Object.values(name)[0] as string;
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
  private async syncProductsInternal(
    sourceProducts: any[],
  ): Promise<{ success: number; error: number }> {
    if (sourceProducts.length === 0) return { success: 0, error: 0 };

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

    this.logger.info(`Batch results: ${successCount} succeeded, ${errorCount} failed.`);
    return { success: successCount, error: errorCount };
  }
}
