import { Logger, SourceAdapter, TargetAdapter } from "./adapter.interface.js";
import { IdentityMap } from "./identity-map.js";

export interface SyncOptions {
  delayMs?: number;
  dryRun?: boolean;
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
   * Runs a full synchronization from source to target.
   */
  async runFullSync(): Promise<void> {
    this.logger.info(`Starting full sync from ${this.source.name} to ${this.target.name}`);

    try {
      const sourceProducts = await this.source.fetchProducts(1, 20);

      this.logger.info(`Fetched ${sourceProducts.length} products from source.`);

      await this.syncProducts(sourceProducts);

      // Save identity map persistence
      await this.identityMap.save();

      this.logger.info("Full sync completed successfully.");
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

      const updatedProducts = await this.source.fetchUpdatedProducts(1, 20, since);
      this.logger.info(`Fetched ${updatedProducts.length} updated products.`);

      await this.syncProducts(updatedProducts);

      // Save identity map persistence
      await this.identityMap.save();

      this.logger.info("Incremental sync completed successfully.");
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

    this.logger.info(`Category sync statistics: ${successCount} succeeded, ${errorCount} failed.`);
  }

  /**
   * Processes a list of source products through transformation and target upsert.
   */
  private async syncProducts(sourceProducts: any[]): Promise<void> {
    if (sourceProducts.length === 0) return;
    let successCount = 0;
    let errorCount = 0;

    for (const sourceProduct of sourceProducts) {
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
          successCount++;
        } else {
          this.logger.info(`[DRY-RUN] Skipped sync for ${sourceProduct.sku}`);
          successCount++;
        }

        // Apply throttle delay if configured
        if (this.options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
        }
      } catch (error) {
        this.logger.error(`Failed to sync product ${sourceProduct.id || "unknown"}:`, error);
        errorCount++;
      }
    }

    this.logger.info(`Sync statistics: ${successCount} succeeded, ${errorCount} failed.`);
  }
}
