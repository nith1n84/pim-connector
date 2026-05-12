import { GraphQLClient } from "graphql-request";
import { Category, Logger } from "@pim-connector/core";
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
  private static globalCollectionIdMap: Map<string, string> = new Map(); // Shared across all collections

  constructor(
    private client: GraphQLClient,
    private mapper: VendureMapper,
    private logger: Logger,
  ) {}

  /**
   * Upserts a collection to Vendure.
   * Checks if a collection exists by slug, then creates or updates accordingly.
   */
  async upsertCollection(
    category: Category,
    parentCollectionIdMap: Map<string, string>,
  ): Promise<string> {
    const existingCollection = await this.findCollectionBySlug(category.code);

    let collectionId: string;

    if (existingCollection) {
      const parentId = category.parentId
        ? (parentCollectionIdMap.get(category.parentId) ?? null)
        : null;
      const updateInput = this.mapper.mapToUpdateCollectionInput(
        existingCollection.id,
        category,
        parentId,
      );
      await this.client.request(UPDATE_COLLECTION, { input: updateInput });
      collectionId = existingCollection.id;
    } else {
      const parentId = category.parentId
        ? (parentCollectionIdMap.get(category.parentId) ?? null)
        : null;
      const createInput = this.mapper.mapToCreateCollectionInput(category, parentId);

      const resp = await this.client.request<{ createCollection: { id: string } }>(
        CREATE_COLLECTION,
        { input: createInput },
      );
      collectionId = resp.createCollection.id;
    }

    // Store in global map for reference
    VendureCollectionService.globalCollectionIdMap.set(category.code, collectionId);
    return collectionId;
  }

  /**
   * Finds a collection by slug.
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
