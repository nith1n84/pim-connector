import { StorageProvider } from "./storage/storage.interface.js";

/**
 * Identity map to track IDs across systems.
 * Uses a StorageProvider for persistence.
 */
export class IdentityMap {
  private map: Map<string, string> = new Map();

  constructor(
    private readonly provider: StorageProvider,
    private readonly storageKey: string,
  ) {}

  /**
   * Loads the mapping from storage.
   */
  async load(): Promise<void> {
    try {
      const data = await this.provider.read(this.storageKey);
      if (data) {
        const json = JSON.parse(data);
        this.map = new Map(Object.entries(json));
      }
    } catch (error) {
      console.error(`Failed to load identity map for ${this.storageKey}:`, error);
    }
  }

  /**
   * Saves the current mapping to storage.
   */
  async save(): Promise<void> {
    try {
      const json = Object.fromEntries(this.map.entries());
      await this.provider.write(this.storageKey, JSON.stringify(json, null, 2));
    } catch (error) {
      console.error(`Failed to save identity map for ${this.storageKey}:`, error);
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
