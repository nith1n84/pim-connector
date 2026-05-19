import { parseArgs } from "node:util";
import { dirname, join } from "node:path";
import {
  BasicLogger,
  FileStorageProvider,
  MappingManager,
  SyncEngine,
  SyncReporter,
  SyncStateManager,
  TokenStore,
  createStorageProvider,
} from "@pim-connector/core";
import { AkeneoAdapter } from "@pim-connector/adapter-akeneo";
import { VendureAdapter } from "@pim-connector/adapter-vendure";
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

  if (
    values.help ||
    positionals.length === 0 ||
    !["sync", "sync-categories"].includes(positionals[0])
  ) {
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

    // Helper to get store configuration with local path fallback relative to config directory
    const getStoreConfig = (storeName: string, adapterConfig: any, fallbackDir: string) => {
      const store = adapterConfig?.stores?.[storeName];
      if (store) {
        if (store.type === "local" && store.config?.baseDir) {
          return {
            type: "local",
            config: {
              ...store.config,
              baseDir: join(projectDir, store.config.baseDir),
            },
          };
        }
        return store;
      }
      return {
        type: "local",
        config: {
          baseDir: join(projectDir, fallbackDir),
        },
      };
    };

    // Instantiate individual storage providers
    const sourceTokenStoreConfig = getStoreConfig("token", config.source, ".sync-data/auth");
    const sourceTokenStorage = createStorageProvider(sourceTokenStoreConfig);
    const sourceTokenStore = new TokenStore(sourceTokenStorage);

    const targetTokenStoreConfig = getStoreConfig("token", config.target, ".sync-data/auth");
    const targetTokenStorage = createStorageProvider(targetTokenStoreConfig);
    const targetTokenStore = new TokenStore(targetTokenStorage);

    const mappingStoreConfig = getStoreConfig("mapping", config.source, ".sync-data");
    const mappingStorage = createStorageProvider(mappingStoreConfig);
    const mappingManager = new MappingManager(mappingStorage, "akeneo", "vendure");

    const syncStateStoreConfig = getStoreConfig("syncState", config.source, ".sync-data");
    const syncStateStorage = createStorageProvider(syncStateStoreConfig);
    const stateManager = new SyncStateManager(syncStateStorage);

    const syncReporterStoreConfig = getStoreConfig(
      "syncReporter",
      config.source,
      ".sync-data/reports",
    );
    const syncReporterStorage = createStorageProvider(syncReporterStoreConfig);

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
      const reporter = new SyncReporter(
        syncReporterStorage,
        command === "sync-categories" ? "category" : "product",
      );

      // 5. Initialize Adapters
      const source = new AkeneoAdapter(config.source.config, sourceTokenStore);
      const target = new VendureAdapter({
        ...config.target.config,
        retries: config.syncOptions?.retries,
        retryDelayMs: config.syncOptions?.retryDelayMs,
        includeAttributes: config.mapping.includeAttributes,
        excludeAttributes: config.mapping.excludeAttributes,
        categoryIdentityMap: categoryMap,
        assetIdentityMap: assetMap,
        tokenStore: targetTokenStore,
      });

      await Promise.all([source.initialize(), target.initialize()]);

      // 6. Run Sync Engine
      const engine = new SyncEngine(source, target, productMap, categoryMap, logger, {
        delayMs: config.syncOptions?.delayMs,
        dryRun: !!values["dry-run"],
        batchSize: config.syncOptions?.batchSize,
        concurrency: config.syncOptions?.concurrency,
        reporter: reporter,
      });

      if (command === "sync-categories") {
        await engine.runCategorySync();
      } else {
        // Automatic Delta Sync logic
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

Commands:
  sync                 Run the product synchronization engine
  sync-categories      Run the category/collection synchronization engine

Options:
  --since <date>      Run incremental sync since date (ISO format)
  --dry-run, -d       Run without writing to target
  --help, -h          Show help
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
