import { Category, Logger } from "@pim-connector/core";
import { MagentoClient } from "../client/magento.client.js";
import { MagentoMapper } from "../mappers/magento.mapper.js";
import { MagentoCategory } from "../types/magento.types.js";
import { MagentoConfig } from "../types/magento.types.js";

/**
 * Service for synchronising Akeneo categories into the Magento category tree.
 *
 * Strategy:
 *  - Root categories (parentId === null) are placed under the configurable rootCategoryId.
 *  - Child categories inherit their resolved parent Magento ID from the parentCollectionIdMap.
 *  - Existing categories are identified by searching for a matching name under the parent.
 *  - After creation, localized names are written per store view via localeMap.
 */
export class MagentoCategoryService {
  constructor(
    private readonly client: MagentoClient,
    private readonly mapper: MagentoMapper,
    private readonly config: MagentoConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates or updates a single category in Magento.
   * Also pushes localized names to each store view in localeMap.
   *
   * @param category - The CDM category.
   * @param targetId - Existing Magento category ID if known (from identity map).
   * @param parentCollectionIdMap - Resolved source→Magento ID map for parent categories.
   * @returns The Magento category ID.
   */
  async upsertCategory(
    category: Category,
    targetId?: string,
    parentCollectionIdMap?: Map<string, string>,
  ): Promise<string> {
    const rootId = this.config.rootCategoryId ?? 2;

    // Resolve parent Magento ID
    let parentMagentoId: number;
    if (category.parentId && parentCollectionIdMap?.has(category.parentId)) {
      parentMagentoId = Number(parentCollectionIdMap.get(category.parentId));
    } else {
      parentMagentoId = rootId;
    }

    let magentoId: number;

    if (targetId) {
      // ── UPDATE ──────────────────────────────────────────────────────────────
      magentoId = Number(targetId);
      const payload = this.mapper.mapToUpdateCategoryPayload(
        magentoId,
        category,
        parentMagentoId,
      );
      await this.client.put<MagentoCategory>(`/V1/categories/${magentoId}`, payload);
      this.logger.debug(`Updated category "${category.code}" (Magento ID: ${magentoId})`);
    } else {
      // ── FIND OR CREATE ───────────────────────────────────────────────────────
      const existing = await this.findCategoryByNameUnderParent(
        Object.values(category.name)[0] || category.code,
        parentMagentoId,
      );

      if (existing) {
        magentoId = existing.id;
        const payload = this.mapper.mapToUpdateCategoryPayload(
          magentoId,
          category,
          parentMagentoId,
        );
        await this.client.put<MagentoCategory>(`/V1/categories/${magentoId}`, payload);
        this.logger.debug(`Updated existing category "${category.code}" (ID: ${magentoId})`);
      } else {
        const payload = this.mapper.mapToCreateCategoryPayload(category, parentMagentoId);
        const created = await this.client.post<MagentoCategory>("/V1/categories", payload);
        magentoId = created.id;
        this.logger.debug(`Created category "${category.code}" (Magento ID: ${magentoId})`);
      }
    }

    // ── LOCALIZED NAMES ──────────────────────────────────────────────────────
    await this.pushLocalizedCategoryNames(magentoId, category);

    return String(magentoId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Searches for a category with a matching name directly under the given parent.
   * Uses Magento's category tree endpoint.
   */
  private async findCategoryByNameUnderParent(
    name: string,
    parentId: number,
  ): Promise<MagentoCategory | null> {
    try {
      const resp = await this.client.get<MagentoCategory & { children_data?: MagentoCategory[] }>(
        `/V1/categories/${parentId}`,
      );

      if (!resp.children_data) return null;

      const normalizedName = name.toLowerCase().trim();
      const match = resp.children_data.find(
        (c) => c.name?.toLowerCase().trim() === normalizedName,
      );
      return match ?? null;
    } catch (error) {
      this.logger.debug(`Could not search children of category ${parentId}:`, error);
      return null;
    }
  }

  /**
   * Writes localized category name to each configured store view.
   */
  private async pushLocalizedCategoryNames(
    magentoId: number,
    category: Category,
  ): Promise<void> {
    const localeMap = this.config.localeMap;
    if (!localeMap) return;

    for (const [locale, storeCode] of Object.entries(localeMap)) {
      // Skip default store (base data was already written)
      if (storeCode === "default" || storeCode === (this.config.storeCode ?? "default")) continue;

      const localizedName = category.name[locale];
      if (!localizedName) continue;

      try {
        const payload = this.mapper.mapToLocalizedCategoryPayload(magentoId, category, locale);
        await this.client.put<MagentoCategory>(
          `/V1/categories/${magentoId}`,
          payload,
          storeCode,
        );
        this.logger.debug(
          `Pushed localized name for category ${magentoId} → store view "${storeCode}"`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to push localized name for category ${magentoId} / store "${storeCode}":`,
          error,
        );
      }
    }
  }
}
