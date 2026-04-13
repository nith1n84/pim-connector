/**
 * Simple in-memory identity map to track IDs across systems.
 * e.g., mapping Akeneo IDs to Vendure IDs.
 */
export class IdentityMap {
  private map: Map<string, string> = new Map();

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
   * @param sourceId ID from the source system.
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
