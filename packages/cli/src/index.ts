import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BasicLogger, IdentityMap } from "@pim-connector/core";
import { AkeneoAdapter } from "@pim-connector/adapter-akeneo";
import { VendureAdapter } from "@pim-connector/adapter-vendure";

async function main() {
  const logger = new BasicLogger("CLI");
  logger.info("Starting PIM Connector...");

  // Load configuration
  const configPath = join(process.cwd(), "../../connector.config.json");
  let config;
  try {
    const configData = await readFile(configPath, "utf-8");
    config = JSON.parse(configData);
    logger.info("Configuration loaded from connector.config.json");
  } catch (error) {
    logger.error(`Failed to load configuration from ${configPath}`);
    process.exit(1);
  }

  const source = new AkeneoAdapter(config.source.config);
  const target = new VendureAdapter({
    ...config.target.config,
    retries: config.syncOptions?.retries,
    retryDelayMs: config.syncOptions?.retryDelayMs,
  });
  const identityMap = new IdentityMap();

  await source.initialize();
  await target.initialize();

  logger.info("Adapters initialized. Ready for sync.");

  // Placeholder for sync logic
  const products = await source.getProducts();
  logger.info(`Found ${products.length} products to sync.`);

  for (const product of products) {
    await target.upsertProduct(product);
    // Add small delay to prevent SQLite locks during heavy writes
    const delay = config.syncOptions?.delayMs ?? 500;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  logger.info("Sync completed.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
