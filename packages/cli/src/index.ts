import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { BasicLogger, IdentityMap, SyncEngine, validateConfig } from "@pim-connector/core";
import { AkeneoAdapter } from "@pim-connector/adapter-akeneo";
import { VendureAdapter } from "@pim-connector/adapter-vendure";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      since: { type: "string" },
      "dry-run": { type: "boolean", short: "d" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const logger = new BasicLogger("CLI");
  let config: any;

  if (
    values.help ||
    positionals.length === 0 ||
    (positionals[0] !== "sync" && positionals[0] !== "sync-categories")
  ) {
    console.log(`
Usage: pim-sync <command> [options]

Commands:
  sync                 Run the product synchronization engine
  sync-categories      Run the category/collection synchronization engine

Options:
  --since <date>      Run incremental sync since date (ISO format) (for product sync only)
  --dry-run, -d       Run without writing to target
  --help, -h          Show help
    `);
    process.exit(0);
  }

  const command = positionals[0];
  logger.info(`Starting PIM Connector... ${values["dry-run"] ? "(DRY RUN)" : ""}`);

  // Load configuration - handle running from root or packages/cli
  let configPath = join(process.cwd(), "connector.config.json");

  // If not found in current dir, check one level up (common for pnpm workspaces)
  try {
    const configData = await readFile(configPath, "utf-8");
    config = JSON.parse(configData);
  } catch (err) {
    configPath = join(process.cwd(), "../../connector.config.json");
    try {
      const configData = await readFile(configPath, "utf-8");
      config = JSON.parse(configData);
    } catch (error) {
      logger.error(`Could not find connector.config.json in current or parent directories.`);
      process.exit(1);
    }
  }

  // Validate configuration
  try {
    config = validateConfig(config);
    logger.info("Configuration validated successfully");
  } catch (error: any) {
    logger.error(error.message);
    process.exit(1);
  }

  // Initialize identity map with persistence
  const identitiesPath = join(dirname(configPath), "identities.json");
  const identityMap = new IdentityMap(identitiesPath);
  await identityMap.load();

  const categoryIdentityPath = join(dirname(configPath), "category.json");
  const categoryIdentityMap = new IdentityMap(categoryIdentityPath);
  await categoryIdentityMap.load();

  const source = new AkeneoAdapter(config.source.config);
  const target = new VendureAdapter({
    ...config.target.config,
    retries: config.syncOptions?.retries,
    retryDelayMs: config.syncOptions?.retryDelayMs,
    includeAttributes: config.mapping.includeAttributes,
    excludeAttributes: config.mapping.excludeAttributes,
    categoryIdentityMap: categoryIdentityMap,
  });

  await source.initialize();
  await target.initialize();

  const engine = new SyncEngine(source, target, identityMap, categoryIdentityMap, logger, {
    delayMs: config.syncOptions?.delayMs,
    dryRun: !!values["dry-run"],
    batchSize: config.syncOptions?.batchSize,
  });

  if (command === "sync-categories") {
    await engine.runCategorySync();
  } else if (values.since) {
    const sinceDate = new Date(values.since);
    if (isNaN(sinceDate.getTime())) {
      logger.error(`Invalid date format for --since: ${values.since}`);
      process.exit(1);
    }
    await engine.runIncrementalSync(sinceDate);
  } else {
    await engine.runFullSync();
  }

  logger.info("Sync operation completed.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
