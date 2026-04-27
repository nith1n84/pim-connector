import { Category } from "@pim-connector/core";
import { AkeneoCategory } from "../types/akeneo.types.js";
import { AkeneoClient } from "../client/akeneo.client.js";
import { AkeneoMapper } from "../mappers/akeneo.mapper.js";

/**
 * Service for handling Akeneo category data operations.
 * Orchestrates fetching, tree building, and mapping to CDM.
 */
export class AkeneoCategoryService {
  constructor(
    private client: AkeneoClient,
    private mapper: AkeneoMapper,
  ) {}

  /**
   * Fetches all categories and maps them to CDM format.
   * Returns categories in breadth-first order (parents before children).
   */
  async getAllCategories(rootCode?: string): Promise<Category[]> {
    let akeneoCategories = await this.client.getCategories();

    // Filter by root code if specified
    if (rootCode) {
      akeneoCategories = this.filterByRoot(akeneoCategories, rootCode);
    }

    // Build category map for quick lookup
    const categoryMap = new Map<string, AkeneoCategory>();
    for (const category of akeneoCategories) {
      categoryMap.set(category.code, category);
    }

    // Sort categories: root categories first, then children in order
    const sortedCategories = this.sortCategoriesBreadthFirst(akeneoCategories, categoryMap);

    // Map to CDM format
    return sortedCategories.map((category, index) =>
      this.mapper.mapToCategory(category, categoryMap, index),
    );
  }

  /**
   * Filters categories to only include those under a specific root category.
   */
  private filterByRoot(categories: AkeneoCategory[], rootCode: string): AkeneoCategory[] {
    const filtered: AkeneoCategory[] = [];
    const root = categories.find((c) => c.code === rootCode);

    if (!root) {
      console.warn(`Root category ${rootCode} not found, returning all categories`);
      return categories;
    }

    // Build a set of all descendant codes
    const descendants = new Set<string>();
    const queue = [rootCode];

    while (queue.length > 0) {
      const current = queue.shift()!;
      descendants.add(current);

      // Find children
      for (const category of categories) {
        if (category.parent === current && !descendants.has(category.code)) {
          descendants.add(category.code);
          queue.push(category.code);
        }
      }
    }

    // Filter to include only descendants
    return categories.filter((c) => descendants.has(c.code));
  }

  /**
   * Sorts categories in breadth-first order (parents before children).
   * This ensures that when syncing to Vendure, parent collections exist before children.
   */
  private sortCategoriesBreadthFirst(
    categories: AkeneoCategory[],
    categoryMap: Map<string, AkeneoCategory>,
  ): AkeneoCategory[] {
    const sorted: AkeneoCategory[] = [];
    const visited = new Set<string>();
    const queue: AkeneoCategory[] = [];

    // Start with root categories (no parent)
    for (const category of categories) {
      if (!category.parent) {
        queue.push(category);
        visited.add(category.code);
      }
    }

    // Process queue in BFS order
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      // Find and enqueue children
      for (const category of categories) {
        if (category.parent === current.code && !visited.has(category.code)) {
          visited.add(category.code);
          queue.push(category);
        }
      }
    }

    // Handle any categories with missing parents (orphans)
    for (const category of categories) {
      if (!visited.has(category.code)) {
        // Add orphan at the end, treating it as a root
        sorted.push({ ...category, parent: null });
      }
    }

    return sorted;
  }
}
