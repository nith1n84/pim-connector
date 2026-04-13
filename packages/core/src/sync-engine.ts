import { SourceAdapter, TargetAdapter, Logger } from "./adapter.interface.js";
import { MappingConfig, transformData } from "./transform.pipeline.js";
import { IdentityMap } from "./identity-map.js";
import { Product } from "./cdm.types.js";

export interface SyncOptions {
  delayMs?: number;
}

export class SyncEngine {
  constructor(
    private source: SourceAdapter,
    private target: TargetAdapter,
    private mapping: MappingConfig,
    private identityMap: IdentityMap,
    private logger: Logger,
    private options: SyncOptions = {}
  ) {}

  /**
   * Runs a full synchronization from source to target.
   */
  async runFullSync(): Promise<void> {
    this.logger.info(`Starting full sync from ${this.source.name} to ${this.target.name}`);

    try {
      const sourceProducts = await this.source.getProducts();
      this.logger.info(`Fetched ${sourceProducts.length} products from source.`);

      await this.syncProducts(sourceProducts);

      this.logger.info("Full sync completed successfully.");
    } catch (error) {
      this.logger.error("Full sync failed:", error);
      throw error;
    }
  }

  /**
   * Runs an incremental synchronization since the specified date.
   */
  async runIncrementalSync(since: Date): Promise<void> {
    this.logger.info(`Starting incremental sync since ${since.toISOString()}`);

    try {
      if (!this.source.getUpdatedProducts) {
        throw new Error(`Source adapter ${this.source.name} does not support incremental sync.`);
      }

      const updatedProducts = await this.source.getUpdatedProducts(since);
      this.logger.info(`Fetched ${updatedProducts.length} updated products.`);

      await this.syncProducts(updatedProducts);

      this.logger.info("Incremental sync completed successfully.");
    } catch (error) {
      this.logger.error("Incremental sync failed:", error);
      throw error;
    }
  }

  /**
   * Processes a list of source products through transformation and target upsert.
   */
  private async syncProducts(sourceProducts: any[]): Promise<void> {
    let successCount = 0;
    let errorCount = 0;

    for (const sourceProduct of sourceProducts) {
      try {
        const transformed: Product = transformData(sourceProduct, this.mapping);
        
        // Log basic info
        this.logger.info(`Syncing product: ${transformed.sku} (${transformed.name})`);

        await this.target.upsertProduct(transformed);
        
        // Track in identity map
        this.identityMap.setMapping(sourceProduct.id || transformed.sku, transformed.sku);

        successCount++;

        // Apply throttle delay if configured
        if (this.options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
        }
      } catch (error) {
        this.logger.error(`Failed to sync product ${sourceProduct.id || 'unknown'}:`, error);
        errorCount++;
      }
    }

    this.logger.info(`Sync statistics: ${successCount} succeeded, ${errorCount} failed.`);
  }
}
