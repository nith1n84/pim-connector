import { readFile, writeFile } from "fs/promises";
import { accessSync } from "fs";
import { dirname, join } from "path";
import { BasicLogger } from "@pim-connector/core";

export interface AssetMapping {
  [sourceId: string]: string; // sourceId -> vendureAssetId
}

export class AssetMappingService {
  private mapping: AssetMapping = {};
  private mappingFilePath: string;
  private logger = new BasicLogger("ASSET MAPPING");

  constructor(projectRoot?: string) {
    // If no project root provided, find the monorepo root by looking for pnpm-workspace.yaml
    const root = projectRoot || this.findMonorepoRoot();
    this.mappingFilePath = join(root, "asset-mapping.json");
  }

  private findMonorepoRoot(): string {
    let currentDir = process.cwd();

    // Traverse up to find the monorepo root (where pnpm-workspace.yaml is located)
    while (currentDir !== "/") {
      const workspaceFile = join(currentDir, "pnpm-workspace.yaml");
      try {
        // Check if pnpm-workspace.yaml exists
        accessSync(workspaceFile);
        return currentDir;
      } catch {
        currentDir = dirname(currentDir);
      }
    }

    // Fallback to current directory if monorepo root not found
    return process.cwd();
  }

  async loadMapping(): Promise<void> {
    try {
      const data = await readFile(this.mappingFilePath, "utf-8");
      this.mapping = JSON.parse(data);
      this.logger.debug(`Loaded asset mapping with ${Object.keys(this.mapping).length} entries`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error("Error loading asset mapping:", error);
      }
      this.mapping = {};
    }
  }

  async saveMapping(): Promise<void> {
    try {
      await writeFile(this.mappingFilePath, JSON.stringify(this.mapping, null, 2), "utf-8");
      this.logger.debug(`Saved asset mapping with ${Object.keys(this.mapping).length} entries`);
    } catch (error) {
      this.logger.error("Error saving asset mapping:", error);
      throw error;
    }
  }

  getVendureAssetId(sourceId: string): string | null {
    const entry = this.mapping[sourceId];
    if (entry) {
      this.logger.debug(`Found existing asset mapping for ${sourceId}: ${entry}`);
      return entry;
    }
    return null;
  }

  async addMapping(sourceId: string, vendureAssetId: string): Promise<void> {
    this.mapping[sourceId] = vendureAssetId;
    await this.saveMapping();
    this.logger.debug(`Added new asset mapping: ${sourceId} -> ${vendureAssetId}`);
  }
}
