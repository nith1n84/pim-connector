import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { Logger, validateConfig } from "@pim-connector/core";

/**
 * Service for loading and validating the connector configuration.
 */
export class ConfigLoader {
  constructor(private readonly logger: Logger) {}

  /**
   * Finds the project root and loads the configuration.
   */
  async load(): Promise<{ config: any; configPath: string }> {
    try {
      const projectRoot = await this.findProjectRoot(process.cwd());

      // Load .env file from project root
      const envPath = join(projectRoot, ".env");
      dotenvConfig({ path: envPath });

      const configPath = join(projectRoot, "connector.config.json");
      const configData = await readFile(configPath, "utf-8");
      const rawConfig = JSON.parse(configData);

      let config = this.substituteEnvVars(rawConfig);
      config = validateConfig(config);

      return { config, configPath };
    } catch (error: any) {
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  private async findProjectRoot(startPath: string): Promise<string> {
    let currentPath = startPath;

    while (currentPath !== dirname(currentPath)) {
      const packageJsonPath = join(currentPath, "package.json");
      const configPath = join(currentPath, "connector.config.json");

      try {
        await readFile(packageJsonPath, "utf-8");
        await readFile(configPath, "utf-8");
        return currentPath;
      } catch {
        currentPath = dirname(currentPath);
      }
    }

    throw new Error("Could not find project root with package.json and connector.config.json");
  }

  private substituteEnvVars(obj: any): any {
    if (typeof obj === "string") {
      return obj.replace(/\$\{([^}]+)}/g, (_match, varName) => {
        const envValue = process.env[varName];
        if (envValue === undefined) {
          throw new Error(
            `Environment variable ${varName} is not set but required in configuration`,
          );
        }
        return envValue;
      });
    } else if (Array.isArray(obj)) {
      return obj.map((v) => this.substituteEnvVars(v));
    } else if (obj !== null && typeof obj === "object") {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.substituteEnvVars(value);
      }
      return result;
    }
    return obj;
  }
}
