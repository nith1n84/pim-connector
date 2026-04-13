import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BasicLogger, IdentityMap, SyncEngine } from "@pim-connector/core";
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

  const engine = new SyncEngine(
    source,
    target,
    config.mapping.attributeMap || {}, // Use mapping from config
    identityMap,
    logger,
    { delayMs: config.syncOptions?.delayMs }
  );

  await engine.runFullSync();

  logger.info("Sync completed.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
