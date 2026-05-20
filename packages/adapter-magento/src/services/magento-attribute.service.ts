import { Logger } from "@pim-connector/core";
import { MagentoClient } from "../client/magento.client.js";
import { MagentoAttribute, MagentoAttributeSet } from "../types/magento.types.js";

/**
 * Service for managing Magento attribute sets and product attributes.
 *
 * Strategy:
 *  - Akeneo Family → Magento Attribute Set (shared, reusable).
 *  - Attribute sets are created once and cached in-process.
 *  - Individual attributes are found-or-created and cached globally.
 */
export class MagentoAttributeService {
  /** In-memory cache: attribute_set_name → attribute_set_id */
  private static attributeSetCache: Map<string, number> = new Map();

  /** In-memory cache: attribute_code → attribute_id */
  private static attributeIdCache: Map<string, number> = new Map();

  constructor(
    private readonly client: MagentoClient,
    private readonly logger: Logger,
  ) {}

  // ---------------------------------------------------------------------------
  // Attribute Sets
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Magento attribute_set_id for an Akeneo family code.
   *
   * Resolution order:
   *  1. In-process cache.
   *  2. Search existing attribute sets via API.
   *  3. Create new attribute set if not found.
   *
   * @param attributeSetName - The Magento attribute set name to find or create.
   * @returns The resolved attribute_set_id.
   */
  async resolveAttributeSetId(attributeSetName: string): Promise<number> {
    // 1. Cache hit
    const cached = MagentoAttributeService.attributeSetCache.get(attributeSetName);
    if (cached !== undefined) return cached;

    // 2. Search via API
    try {
      const existing = await this.findAttributeSetByName(attributeSetName);
      if (existing) {
        this.logger.debug(`Found existing attribute set "${attributeSetName}" (ID: ${existing})`);
        MagentoAttributeService.attributeSetCache.set(attributeSetName, existing);
        return existing;
      }
    } catch (error) {
      this.logger.warn(`Error searching for attribute set "${attributeSetName}":`, error);
    }

    // 3. Create
    this.logger.info(`Creating attribute set: "${attributeSetName}"`);
    const id = await this.createAttributeSet(attributeSetName);
    MagentoAttributeService.attributeSetCache.set(attributeSetName, id);
    return id;
  }

  /**
   * Searches for an attribute set by exact name match.
   * @returns The attribute_set_id, or null if not found.
   */
  private async findAttributeSetByName(name: string): Promise<number | null> {
    const encoded = encodeURIComponent(name);
    try {
      const resp = await this.client.get<{ items: MagentoAttributeSet[] }>(
        `/V1/eav/attribute-sets/list?searchCriteria[filter_groups][0][filters][0][field]=attribute_set_name&searchCriteria[filter_groups][0][filters][0][value]=${encoded}&searchCriteria[filter_groups][0][filters][0][condition_type]=eq`,
      );
      return resp.items?.[0]?.attribute_set_id ?? null;
    } catch (error) {
      this.logger.debug(`Attribute set search failed for "${name}":`, error);
      return null;
    }
  }

  /**
   * Creates a new attribute set based on the Default (entity_type_id = 4) skeleton.
   */
  private async createAttributeSet(name: string): Promise<number> {
    const resp = await this.client.post<MagentoAttributeSet>("/V1/eav/attribute-sets", {
      attributeSet: {
        attribute_set_name: name,
        sort_order: 100,
        entity_type_id: 4, // Catalog product
      },
      skeletonId: 4, // Clone from Default attribute set
    });

    this.logger.info(`Created attribute set "${name}" (ID: ${resp.attribute_set_id})`);
    return resp.attribute_set_id;
  }

  // ---------------------------------------------------------------------------
  // Attributes
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Magento attribute_id for a given attribute code.
   * Creates the attribute if it does not exist.
   *
   * @param code - Attribute code (e.g. "color", "size").
   * @param label - Human-readable label for the attribute.
   * @param frontendInput - Magento frontend type ("select", "multiselect", "text", etc.)
   * @returns The resolved attribute_id.
   */
  async resolveAttributeId(
    code: string,
    label: string,
    frontendInput: "select" | "multiselect" | "text" | "textarea" = "text",
  ): Promise<number> {
    // 1. Cache hit
    const cached = MagentoAttributeService.attributeIdCache.get(code);
    if (cached !== undefined) return cached;

    // 2. Fetch from API
    try {
      const attr = await this.client.get<MagentoAttribute>(`/V1/products/attributes/${code}`);
      if (attr?.attribute_id) {
        MagentoAttributeService.attributeIdCache.set(code, attr.attribute_id);
        return attr.attribute_id;
      }
    } catch {
      // 404 means attribute does not exist — fall through to create
    }

    // 3. Create attribute
    this.logger.info(`Creating attribute: ${code} (${frontendInput})`);
    const created = await this.client.post<MagentoAttribute>("/V1/products/attributes", {
      attribute: {
        attribute_code: code,
        frontend_input: frontendInput,
        default_frontend_label: label || code,
        is_required: false,
        is_searchable: true,
        is_filterable: true,
        is_comparable: false,
        is_visible_on_front: true,
        is_user_defined: true,
        scope: "global",
      },
    });

    MagentoAttributeService.attributeIdCache.set(code, created.attribute_id);
    return created.attribute_id;
  }

  /**
   * Resolves attribute IDs for a list of configurable attribute codes.
   * Returns a Map from attribute_code → attribute_id.
   */
  async resolveConfigurableAttributeIds(
    codes: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    await Promise.all(
      codes.map(async (code) => {
        try {
          const id = await this.resolveAttributeId(code, code, "select");
          result.set(code, id);
        } catch (error) {
          this.logger.warn(`Could not resolve attribute ID for "${code}":`, error);
        }
      }),
    );
    return result;
  }

  /**
   * Assigns a custom attribute to an attribute set and attribute group.
   * Silently ignores if already assigned.
   */
  async assignAttributeToSet(
    attributeCode: string,
    attributeSetId: number,
    attributeGroupId: number,
  ): Promise<void> {
    try {
      await this.client.post(
        `/V1/products/attribute-sets/${attributeSetId}/attributes`,
        {
          attributeCode,
          attributeGroupId,
          sortOrder: 100,
        },
      );
    } catch (error: any) {
      // Ignore "already exists" type errors
      if (!error.message?.includes("already")) {
        this.logger.debug(`Could not assign attribute "${attributeCode}" to set ${attributeSetId}:`, error);
      }
    }
  }
}
