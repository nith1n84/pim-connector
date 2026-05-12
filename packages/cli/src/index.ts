import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { config as dotenvConfig } from "dotenv";
import { BasicLogger, IdentityMap, SyncEngine, validateConfig } from "@pim-connector/core";
import { AkeneoAdapter } from "@pim-connector/adapter-akeneo";
import { VendureAdapter } from "@pim-connector/adapter-vendure";

// Load environment variables from .env file
// We'll load it later after finding the project root

// Function to substitute environment variables in configuration
function substituteEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    // Replace ${VAR_NAME} with process.env.VAR_NAME
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(`Environment variable ${varName} is not set but required in configuration`);
      }
      return envValue;
    });
  } else if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  } else if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

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

  // Find project root by looking for package.json and connector.config.json
  async function findProjectRoot(startPath: string): Promise<string> {
    let currentPath = startPath;

    while (currentPath !== dirname(currentPath)) {
      const packageJsonPath = join(currentPath, "package.json");
      const configPath = join(currentPath, "connector.config.json");

      try {
        // Check if both package.json and connector.config.json exist
        await readFile(packageJsonPath, "utf-8");
        await readFile(configPath, "utf-8");
        return currentPath;
      } catch {
        // Continue searching up the directory tree
        currentPath = dirname(currentPath);
      }
    }

    throw new Error("Could not find project root with package.json and connector.config.json");
  }

  // Load configuration from project root
  let configPath: string;
  try {
    const projectRoot = await findProjectRoot(process.cwd());
    
    // Load .env file from project root
    const envPath = join(projectRoot, ".env");
    dotenvConfig({ path: envPath });
    
    configPath = join(projectRoot, "connector.config.json");
    const configData = await readFile(configPath, "utf-8");
    const rawConfig = JSON.parse(configData);
    config = substituteEnvVars(rawConfig);
    logger.info(`Found configuration at: ${configPath}`);
  } catch (error: any) {
    logger.error(
      `Could not find connector.config.json. Please ensure you're running the command from within the project directory. Error: ${error.message}`,
    );
    process.exit(1);
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
    concurrency: config.syncOptions?.concurrency,
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
