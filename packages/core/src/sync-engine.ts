import { Attribute, AttributeOption, AttributeOptionsGroup, Family } from "./cdm.types.js";
import { Logger, SourceAdapter, TargetAdapter } from "./adapter.interface.js";
import { IdentityMap } from "./identity-map.js";
import { ParallelProcessor } from "./utils/parallel-processor.js";
import { SyncReporter } from "./reporting/sync-reporter.js";

export interface SyncOptions {
  delayMs?: number;
  dryRun?: boolean;
  batchSize?: number;
  concurrency?: number;
  reporter?: SyncReporter;
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

  // ---------------------------------------------------------------------------
  // Schema Sync
  // ---------------------------------------------------------------------------

  /**
   * Runs a full schema synchronization in the correct dependency order:
   *   1. sync-attributes      — create all Magento attributes
   *   2. sync-attribute-options — create all attribute options (select/multiselect)
   *   3. sync-families         — create Magento attribute sets from Akeneo families
   *   4. assign-to-families    — assign attributes to their attribute sets
   *
   * Must be run before sync-categories and sync-products.
   */
  async syncSchema(): Promise<void> {
    this.logger.info(`Starting schema sync: ${this.source.name} -> ${this.target.name}`);

    if (!this.source.getFamilies || !this.source.getAttributes || !this.source.getAttributeOptions) {
      throw new Error(
        `Source adapter "${this.source.name}" does not support schema sync (getFamilies/getAttributes/getAttributeOptions not implemented).`,
      );
    }
    if (!this.target.upsertAttribute || !this.target.upsertAttributeOptions ||
        !this.target.upsertAttributeSet || !this.target.assignAttributesToSet) {
      throw new Error(
        `Target adapter "${this.target.name}" does not support schema sync (upsertAttribute/upsertAttributeSet/assignAttributesToSet not implemented).`,
      );
    }

    // ── Step 1: Fetch families to know which attributes exist ─────────────────
    this.logger.info("[1/4] Fetching families from source...");
    const families = await this.source.getFamilies();
    this.logger.info(`Fetched ${families.length} families.`);

    const familyCodes = families.map((f) => f.code);

    // ── Step 2: sync-attributes ───────────────────────────────────────────────
    this.logger.info("[2/4] Syncing attributes...");
    const attributes = await this.source.getAttributes(familyCodes);
    this.logger.info(`Fetched ${attributes.length} attributes. Creating in target...`);

    const attributeSetIdMap = new Map<string, string>(); // familyCode → attributeSetId
    let attrSuccess = 0;
    let attrError = 0;

    for (const attribute of attributes) {
      try {
        if (!this.options.dryRun) {
          await this.target.upsertAttribute!(attribute);
        } else {
          this.logger.debug(`[DRY-RUN] Would upsert attribute: ${attribute.code}`);
        }
        this.options.reporter?.logSuccess(attribute.code);
        attrSuccess++;
      } catch (error: any) {
        this.logger.error(`Failed to upsert attribute ${attribute.code}:`, error);
        this.options.reporter?.logError(attribute.code, error.message);
        attrError++;
      }
    }
    this.logger.info(`Attributes: ${attrSuccess} succeeded, ${attrError} failed.`);

    // ── Step 3: sync-attribute-options ────────────────────────────────────────
    this.logger.info("[3/4] Syncing attribute options...");
    const selectAttrCodes = attributes
      .filter((a) => a.type === "pim_catalog_simpleselect" || a.type === "pim_catalog_multiselect")
      .map((a) => a.code);

    if (selectAttrCodes.length > 0) {
      const optionGroups = await this.source.getAttributeOptions!(selectAttrCodes);
      let optSuccess = 0;
      let optError = 0;

      for (const group of optionGroups) {
        try {
          if (!this.options.dryRun) {
            await this.target.upsertAttributeOptions!(group.options, group.attributeCode);
          } else {
            this.logger.debug(`[DRY-RUN] Would upsert ${group.options.length} options for ${group.attributeCode}`);
          }
          this.options.reporter?.logSuccess(group.attributeCode);
          optSuccess++;
        } catch (error: any) {
          this.logger.error(`Failed to upsert options for ${group.attributeCode}:`, error);
          this.options.reporter?.logError(group.attributeCode, error.message);
          optError++;
        }
      }
      this.logger.info(`Attribute options: ${optSuccess} groups succeeded, ${optError} failed.`);
    } else {
      this.logger.info("No select/multiselect attributes found — skipping attribute options sync.");
    }

    // ── Step 4: sync-families (attribute sets) ────────────────────────────────
    this.logger.info("[4/4] Syncing families as attribute sets...");
    let famSuccess = 0;
    let famError = 0;

    for (const family of families) {
      try {
        if (!this.options.dryRun) {
          const setId = await this.target.upsertAttributeSet!(family);
          attributeSetIdMap.set(family.code, setId);

          // Assign attributes to the set
          if (family.attributeCodes.length > 0) {
            await this.target.assignAttributesToSet!(setId, family.attributeCodes);
          }
        } else {
          this.logger.debug(`[DRY-RUN] Would upsert attribute set for family: ${family.code}`);
        }
        this.options.reporter?.logSuccess(family.code);
        famSuccess++;
      } catch (error: any) {
        this.logger.error(`Failed to upsert attribute set for family ${family.code}:`, error);
        this.options.reporter?.logError(family.code, error.message);
        famError++;
      }
    }
    this.logger.info(`Families: ${famSuccess} succeeded, ${famError} failed.`);

    this.logger.info("Schema sync completed.");
  }
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
      this.options.reporter?.logSuccess(product.sku || product.id);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Failed to sync product ${product.sku || product.id}:`, error);
      this.options.reporter?.logError(product.sku || product.id, error.message);
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
        this.options.reporter?.logSuccess(cat.code);
        success++;

        if (this.options.delayMs) {
          await new Promise((r) => setTimeout(r, this.options.delayMs));
        }
      } catch (error: any) {
        this.logger.error(`Failed to sync category ${cat.code}:`, error);
        this.options.reporter?.logError(cat.code, error.message);
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
