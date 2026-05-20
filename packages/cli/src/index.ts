import { parseArgs } from "node:util";
import { dirname } from "node:path";
import {
  BasicLogger,
  FileStorageProvider,
  MappingManager,
  SyncEngine,
  SyncReporter,
  SyncStateManager,
  TargetAdapter,
  TokenStore,
} from "@pim-connector/core";
import { AkeneoAdapter } from "@pim-connector/adapter-akeneo";
import { VendureAdapter } from "@pim-connector/adapter-vendure";
import { MagentoAdapter } from "@pim-connector/adapter-magento";
import { ConfigLoader } from "./services/config-loader.js";

/**
 * Main entry point for the PIM Connector CLI.
 */
async function main() {
  const args = parseArgs({
    options: {
      since: { type: "string" },
      "dry-run": { type: "boolean", short: "d" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const { values, positionals } = args;
  const logger = new BasicLogger("CLI", process.env.LOG_LEVEL);

  const VALID_COMMANDS = ["sync", "sync-products", "sync-categories", "sync-schema"];

  if (values.help || positionals.length === 0 || !VALID_COMMANDS.includes(positionals[0])) {
    showHelp();
    return;
  }

  const command = positionals[0];
  const runStartTime = new Date();
  logger.info(`Starting PIM Connector... ${values["dry-run"] ? "(DRY RUN)" : ""}`);

  try {
    // 1. Load and Validate Configuration
    const loader = new ConfigLoader(logger);
    const { config, configPath } = await loader.load();
    logger.info(`Configuration loaded from: ${configPath}`);

    // 2. Initialize Persistence Layer
    const projectDir = dirname(configPath);
    const storageProvider = new FileStorageProvider(projectDir);
    const mappingManager = new MappingManager(storageProvider, "akeneo", "vendure");
    const stateManager = new SyncStateManager(storageProvider);
    const tokenStore = new TokenStore(storageProvider);

    // 2.1 Acquire Lock (Skip for dry-run to allow testing during active syncs)
    if (!values["dry-run"]) {
      await stateManager.acquireLock();
    }

    try {
      // 3. Initialize Identity Maps for Entities
      const productMap = await mappingManager.getIdentityMap("products");
      const categoryMap = await mappingManager.getIdentityMap("categories");
      const assetMap = await mappingManager.getIdentityMap("assets");

      // 4. Initialize Reporter
      const reporterType =
        command === "sync-categories" ? "category"
        : command === "sync-schema"   ? "schema"
        : "product";
      const reporter = new SyncReporter(storageProvider, reporterType);

      // 5. Initialize Adapters
      const source = new AkeneoAdapter(config.source.config, tokenStore);

      let target: TargetAdapter;
      if (config.target.adapter === "magento") {
        target = new MagentoAdapter({
          ...config.target.config,
          retries: config.syncOptions?.retries,
          retryDelayMs: config.syncOptions?.retryDelayMs,
          categoryIdentityMap: categoryMap,
          assetIdentityMap: assetMap,
          tokenStore: tokenStore,
        });
      } else {
        // Default: Vendure
        target = new VendureAdapter({
          ...config.target.config,
          retries: config.syncOptions?.retries,
          retryDelayMs: config.syncOptions?.retryDelayMs,
          includeAttributes: config.mapping.includeAttributes,
          excludeAttributes: config.mapping.excludeAttributes,
          categoryIdentityMap: categoryMap,
          assetIdentityMap: assetMap,
          tokenStore: tokenStore,
        });
      }

      await Promise.all([source.initialize(), target.initialize()]);

      // 6. Run Sync Engine
      const engine = new SyncEngine(source, target, productMap, categoryMap, logger, {
        delayMs: config.syncOptions?.delayMs,
        dryRun: !!values["dry-run"],
        batchSize: config.syncOptions?.batchSize,
        concurrency: config.syncOptions?.concurrency,
        reporter: reporter,
      });

      if (command === "sync-schema") {
        // ── Schema Sync: attributes → options → families → assign ─────────────────
        await engine.syncSchema();
      } else if (command === "sync-categories") {
        // ── Category Sync ────────────────────────────────────────────────
        await engine.runCategorySync();
      } else {
        // ── Product Sync ("sync" or "sync-products") ───────────────────────────
        let sinceDate: Date | undefined;
        if (values.since) {
          sinceDate = parseSinceDate(values.since);
        } else {
          sinceDate = (await stateManager.getLastRunDate()) || undefined;
          if (sinceDate) {
            logger.info(`Performing delta sync since last run: ${sinceDate.toISOString()}`);
          } else {
            logger.info("No previous sync state found. Performing full sync.");
          }
        }

        await engine.syncProducts(sinceDate);

        // Update state on success
        if (!values["dry-run"]) {
          await stateManager.updateState({
            lastRunStartTime: runStartTime.toISOString(),
            lastSuccessfulRun: new Date().toISOString(),
          });
        }
      }

      // 7. Finalize Results
      if (!values["dry-run"]) {
        await assetMap.save();
        const reportKey = await reporter.save();
        logger.info(`Run report saved to: ${reportKey}`);
      }
    } finally {
      // 8. Always release lock if we acquired it
      if (!values["dry-run"]) {
        await stateManager.releaseLock();
      }
    }

    logger.info("Sync operation completed successfully.");
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
Usage: pim-sync <command> [options]

Recommended order for Magento targets:
  pim-sync sync-schema        ← run FIRST: syncs attributes, options, families
  pim-sync sync-categories    ← run SECOND
  pim-sync sync-products      ← run THIRD

Commands:
  sync-schema          Sync Akeneo schema to Magento (4 sub-steps):
                         1. sync-attributes      — create Magento attributes
                         2. sync-attribute-options — create select/multiselect options
                         3. sync-families         — create Magento attribute sets
                         4. assign-to-families    — assign attributes to sets
  sync-categories      Sync the Akeneo category tree to the target
  sync-products        Sync products and variants (alias: sync)
  sync                 Alias for sync-products

Options:
  --since <date>      Run incremental product sync since date (ISO format)
  --dry-run, -d       Run without writing to target (safe preview)
  --help, -h          Show this help
  `);
}

function parseSinceDate(since?: string): Date | undefined {
  if (!since) return undefined;
  const date = new Date(since);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format for --since: ${since}`);
  }
  return date;
}

main().catch((err) => {
  console.error("Critical Failure:", err);
  process.exit(1);
});
