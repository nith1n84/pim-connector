import { IdentityMap } from "./identity-map.js";
import { StorageProvider } from "./storage/storage.interface.js";

/**
 * Service for managing multiple identity maps with standardized naming.
 */
export class MappingManager {
  constructor(
    private readonly provider: StorageProvider,
    private readonly sourceName: string,
    private readonly targetName: string,
  ) {}

  /**
   * Creates and initializes an identity map for a specific entity.
   * @param entity - The entity name (e.g., 'products', 'categories', 'assets').
   * @returns An initialized IdentityMap.
   */
  async getIdentityMap(entity: string): Promise<IdentityMap> {
    const key = this.generateKey(entity);
    const map = new IdentityMap(this.provider, key);
    await map.load();
    return map;
  }

  /**
   * Generates a standardized storage key for an entity.
   * Pattern: {source}-{target}-{entity}-map.json
   */
  private generateKey(entity: string): string {
    return `${this.sourceName}-${this.targetName}-${entity}-map.json`;
  }
}
