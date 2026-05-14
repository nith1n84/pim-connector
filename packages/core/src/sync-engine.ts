import { Logger, SourceAdapter, TargetAdapter } from "./adapter.interface.js";
import { IdentityMap } from "./identity-map.js";
import { ParallelProcessor } from "./utils/parallel-processor.js";

export interface SyncOptions {
  delayMs?: number;
  dryRun?: boolean;
  batchSize?: number;
  concurrency?: number;
}

/**
 * Core synchronization engine.
 * Orchestrates the flow of data between source and target adapters.
 */
export class SyncEngine {
  constructor(
    private readonly source: SourceAdapter,
    private readonly target: TargetAdapter,
    private readonly identityMap: IdentityMap,
    private readonly categoryIdentityMap: IdentityMap,
    private readonly logger: Logger,
    private readonly options: SyncOptions = {},
  ) {}

  /**
   * Runs a product synchronization.
   * @param since - Optional date for incremental synchronization.
   */
  async syncProducts(since?: Date): Promise<void> {
    const syncType = since ? "incremental" : "full";
    this.logger.info(
      `Starting ${syncType} product sync: ${this.source.name} -> ${this.target.name}${since ? ` (since ${since.toISOString()})` : ""}`,
    );

    let successCount = 0;
    let errorCount = 0;
    let totalFetched = 0;

    try {
      const batchSize = this.options.batchSize || 10;
      let page = 1;

      while (true) {
        const products = await this.source.fetchProducts(page, batchSize, since);
        if (products.length === 0) break;

        totalFetched += products.length;
        this.logger.info(`Fetched batch of ${products.length} products (Total: ${totalFetched})`);

        const batchResults = await this.processProductBatch(products);
        successCount += batchResults.success;
        errorCount += batchResults.error;

        page++;
      }

      await this.identityMap.save();
      this.printSummary(syncType, totalFetched, successCount, errorCount);
    } catch (error) {
      this.logger.error(`${syncType} sync failed:`, error);
      throw error;
    }
  }

  /**
   * Runs a category synchronization.
   */
  async runCategorySync(): Promise<void> {
    this.logger.info(`Starting category sync: ${this.source.name} -> ${this.target.name}`);

    try {
      if (!this.source.getCategories || !this.target.upsertCollection) {
        throw new Error("Adapters do not support category synchronization.");
      }

      const categories = await this.source.getCategories();
      this.logger.info(`Fetched ${categories.length} categories.`);

      const sorted = this.sortCategoriesByHierarchy(categories);
      await this.syncCategoriesBatch(sorted);

      await this.categoryIdentityMap.save();
      this.logger.info("Category sync completed.");
    } catch (error) {
      this.logger.error("Category sync failed:", error);
      throw error;
    }
  }

  private async processProductBatch(products: any[]): Promise<{ success: number; error: number }> {
    const concurrency = this.options.concurrency || 5;
    const results = await ParallelProcessor.map(
      products,
      (p) => this.syncSingleProduct(p),
      concurrency,
    );

    const success = results.filter((r) => r.success).length;
    return { success, error: products.length - success };
  }

  private async syncSingleProduct(product: any): Promise<{ success: boolean }> {
    try {
      const sourceId = product.id || product.sku;
      const targetId = this.identityMap.getTargetId(sourceId);

      if (this.options.dryRun) {
        this.logger.debug(`[DRY-RUN] Would sync product: ${product.sku}`);
        return { success: true };
      }

      const newTargetId = await this.target.upsertProduct(product, targetId);
      this.identityMap.setMapping(sourceId, newTargetId);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to sync product ${product.sku || product.id}:`, error);
      return { success: false };
    }
  }

  private async syncCategoriesBatch(categories: any[]): Promise<void> {
    const parentMap = new Map<string, string>();
    let success = 0;

    for (const cat of categories) {
      try {
        const sourceId = cat.id || cat.code;
        const targetId = this.categoryIdentityMap.getTargetId(sourceId);

        if (!this.options.dryRun) {
          const newId = await this.target.upsertCollection!(cat, targetId, parentMap);
          this.categoryIdentityMap.setMapping(sourceId, newId);
          parentMap.set(cat.code, newId);
        }
        success++;

        if (this.options.delayMs) {
          await new Promise((r) => setTimeout(r, this.options.delayMs));
        }
      } catch (error) {
        this.logger.error(`Failed to sync category ${cat.code}:`, error);
      }
    }
  }

  private sortCategoriesByHierarchy(categories: any[]): any[] {
    const map = new Map(categories.map((c) => [c.code || c.id, c]));
    const sorted: any[] = [];
    const visited = new Set<string>();

    const visit = (c: any) => {
      const id = c.code || c.id;
      if (visited.has(id)) return;
      if (c.parentId && map.has(c.parentId)) visit(map.get(c.parentId));
      visited.add(id);
      sorted.push(c);
    };

    categories.forEach(visit);
    return sorted;
  }

  private printSummary(type: string, total: number, success: number, error: number): void {
    this.logger.info("--------------------------------------------------");
    this.logger.info(`${type.toUpperCase()} SYNC SUMMARY:`);
    this.logger.info(`- Total:     ${total}`);
    this.logger.info(`- Succeeded: ${success}`);
    this.logger.info(`- Failed:    ${error}`);
    this.logger.info("--------------------------------------------------");
  }
}
