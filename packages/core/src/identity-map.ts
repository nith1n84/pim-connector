import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Identity map to track IDs across systems with file-based persistence.
 */
export class IdentityMap {
  private map: Map<string, string> = new Map();

  constructor(private filePath?: string) {}

  /**
   * Loads the mapping from the specified file path.
   */
  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const data = await readFile(this.filePath, "utf-8");
      const json = JSON.parse(data);
      this.map = new Map(Object.entries(json));
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        console.error(`Failed to load identity map from ${this.filePath}:`, error);
      }
    }
  }

  /**
   * Saves the current mapping to the specified file path.
   */
  async save(): Promise<void> {
    if (!this.filePath) return;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const json = Object.fromEntries(this.map.entries());
      await writeFile(this.filePath, JSON.stringify(json, null, 2));
    } catch (error) {
      console.error(`Failed to save identity map to ${this.filePath}:`, error);
    }
  }

  /**
   * Set a mapping between a source ID and a target ID.
   * @param sourceId ID from the source system (e.g., Akeneo)
   * @param targetId ID from the target system (e.g., Vendure)
   */
  setMapping(sourceId: string, targetId: string): void {
    this.map.set(sourceId, targetId);
  }

  /**
   * Get the target ID for a given source ID.
   */
  getTargetId(sourceId: string): string | undefined {
    return this.map.get(sourceId);
  }

  /**
   * Check if a mapping exists for a source ID.
   */
  hasMapping(sourceId: string): boolean {
    return this.map.has(sourceId);
  }

  /**
   * For debugging: returns all mappings.
   */
  getMappings(): Array<{ sourceId: string; targetId: string }> {
    return Array.from(this.map.entries()).map(([sourceId, targetId]) => ({
      sourceId,
      targetId,
    }));
  }

  clear(): void {
    this.map.clear();
  }
}
