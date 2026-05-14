import { Category, Logger } from "@pim-connector/core";
import { VendureClient } from "../client/vendure.client.js";
import { VendureMapper } from "../mappers/vendure.mapper.js";
import {
  CREATE_COLLECTION,
  GET_COLLECTION_BY_SLUG,
  UPDATE_COLLECTION,
} from "../types/vendure.types.js";

/**
 * Service for handling Vendure collection operations.
 * Orchestrates collection creation, updates, and parent-child relationships.
 */
export class VendureCollectionService {
  private static globalCollectionIdMap: Map<string, string> = new Map();

  constructor(
    private readonly client: VendureClient,
    private readonly mapper: VendureMapper,
    private readonly logger: Logger,
  ) {}

  /**
   * Upserts a collection to Vendure.
   * Checks if a collection exists by slug, then creates or updates accordingly.
   * @param category - The source category to sync.
   * @param parentCollectionIdMap - Map of source parent codes to target IDs.
   * @returns The ID of the upserted collection.
   */
  async upsertCollection(
    category: Category,
    parentCollectionIdMap: Map<string, string>,
  ): Promise<string> {
    const existingCollection = await this.findCollectionBySlug(category.code);

    let collectionId: string;

    const parentId = category.parentId
      ? (parentCollectionIdMap.get(category.parentId) ?? null)
      : null;

    if (existingCollection) {
      const updateInput = this.mapper.mapToUpdateCollectionInput(
        existingCollection.id,
        category,
        parentId,
      );
      await this.client.request(UPDATE_COLLECTION, { input: updateInput });
      collectionId = existingCollection.id;
    } else {
      const createInput = this.mapper.mapToCreateCollectionInput(category, parentId);

      const resp = await this.client.request<{ createCollection: { id: string } }>(
        CREATE_COLLECTION,
        { input: createInput },
      );
      collectionId = resp.createCollection.id;
    }

    VendureCollectionService.globalCollectionIdMap.set(category.code, collectionId);
    return collectionId;
  }

  /**
   * Finds a collection by its slug.
   * @param slug - The slug of the collection.
   * @returns The collection ID and slug if found, null otherwise.
   */
  private async findCollectionBySlug(slug: string): Promise<{ id: string } | null> {
    try {
      const resp = await this.client.request<{ collections: { items: Array<{ id: string }> } }>(
        GET_COLLECTION_BY_SLUG,
        { slug },
      );
      return resp.collections.items[0] || null;
    } catch (error) {
      this.logger.error(`Error finding collection by slug ${slug}:`, error);
      return null;
    }
  }

  /**
   * Gets the global collection ID map.
   */
  static getGlobalCollectionIdMap(): Map<string, string> {
    return VendureCollectionService.globalCollectionIdMap;
  }

  /**
   * Clears the global collection ID map.
   */
  static clearGlobalCollectionIdMap(): void {
    VendureCollectionService.globalCollectionIdMap.clear();
  }
}
