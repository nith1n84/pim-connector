import { parseArgs } from "node:util";
import { dirname, join } from "node:path";
import { BasicLogger, FileStorageProvider, MappingManager, SyncEngine } from "@pim-connector/core";
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

    // 3. Initialize Identity Maps for Entities
    const productMap = await mappingManager.getIdentityMap("products");
    const categoryMap = await mappingManager.getIdentityMap("categories");
    const assetMap = await mappingManager.getIdentityMap("assets");

    // 4. Initialize Adapters
    const source = new AkeneoAdapter(config.source.config);
    const target = new VendureAdapter({
      ...config.target.config,
      retries: config.syncOptions?.retries,
      retryDelayMs: config.syncOptions?.retryDelayMs,
      includeAttributes: config.mapping.includeAttributes,
      excludeAttributes: config.mapping.excludeAttributes,
      categoryIdentityMap: categoryMap,
      assetIdentityMap: assetMap,
    });

    await Promise.all([source.initialize(), target.initialize()]);

    // 5. Run Sync Engine
    const engine = new SyncEngine(source, target, productMap, categoryMap, logger, {
      delayMs: config.syncOptions?.delayMs,
      dryRun: !!values["dry-run"],
      batchSize: config.syncOptions?.batchSize,
      concurrency: config.syncOptions?.concurrency,
    });

    if (command === "sync-categories") {
      await engine.runCategorySync();
    } else {
      const sinceDate = parseSinceDate(values.since);
      await engine.syncProducts(sinceDate);
    }

    // Save mapping for assets (special case as it's modified within the adapter)
    if (!values["dry-run"]) {
      await assetMap.save();
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
