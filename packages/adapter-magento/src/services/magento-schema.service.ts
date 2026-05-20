import { Attribute, AttributeOption, Family, Logger } from "@pim-connector/core";
import { MagentoClient } from "../client/magento.client.js";
import { MagentoAttributeService } from "./magento-attribute.service.js";

/**
 * Service for provisioning the full Magento schema from Akeneo definitions.
 *
 * Sync order (must be respected):
 *   1. upsertAttribute()         — create the attribute in eav_attribute
 *   2. upsertAttributeOptions()  — create select options in eav_attribute_option
 *   3. upsertAttributeSet()      — create attribute set in eav_attribute_set
 *   4. assignAttributesToSet()   — assign attributes → set in eav_entity_attribute
 */
export class MagentoSchemaService {
  /**
   * In-process cache: familyCode → Magento attributeSetId
   * Shared across calls within one run so assignAttributesToSet can reuse it.
   */
  private static attributeSetIdCache = new Map<string, number>();

  constructor(
    private readonly client: MagentoClient,
    private readonly attributeService: MagentoAttributeService,
    private readonly logger: Logger,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Attributes
  // ---------------------------------------------------------------------------

  /**
   * Creates or updates a Magento attribute from a CDM Attribute.
   * Maps Akeneo attribute types to Magento frontend_input types.
   *
   * @returns The Magento attribute_code (same as CDM code).
   */
  async upsertAttribute(attribute: Attribute): Promise<string> {
    const frontendInput = this.mapAkeneoTypeToMagentoInput(attribute.type);
    const label = this.getLabel(attribute.labels) || attribute.code;

    await this.attributeService.resolveAttributeId(attribute.code, label, frontendInput as any);
    this.logger.debug(`Upserted attribute: ${attribute.code} (${frontendInput})`);
    return attribute.code;
  }

  // ---------------------------------------------------------------------------
  // 2. Attribute Options
  // ---------------------------------------------------------------------------

  /**
   * Creates any missing attribute options for a select/multiselect attribute.
   * Existing options are detected by label comparison and skipped.
   *
   * @param options - CDM AttributeOption list for one attribute.
   * @param attributeCode - The parent attribute code.
   */
  async upsertAttributeOptions(options: AttributeOption[], attributeCode: string): Promise<void> {
    if (options.length === 0) return;

    // Fetch existing options to avoid duplicates
    const existingOptions = await this.getExistingOptions(attributeCode);
    const existingLabels = new Set(
      existingOptions.map((o: any) => (o.label || "").toLowerCase()),
    );

    let created = 0;
    for (const option of options) {
      const label = this.getLabel(option.labels) || option.code;

      // Skip if this option already exists (by label, case-insensitive)
      if (existingLabels.has(label.toLowerCase())) {
        this.logger.debug(`Option "${label}" already exists on ${attributeCode} — skipping.`);
        continue;
      }

      try {
        await this.client.post(
          `/V1/products/attributes/${encodeURIComponent(attributeCode)}/options`,
          {
            option: {
              label,
              sort_order: option.sortOrder,
              is_default: false,
              store_labels: this.buildStoreLabels(option.labels),
            },
          },
        );
        created++;
        this.logger.debug(`Created option "${label}" on attribute ${attributeCode}`);
      } catch (error) {
        this.logger.warn(`Failed to create option "${label}" on ${attributeCode}:`, error);
      }
    }

    if (created > 0) {
      this.logger.debug(`Created ${created}/${options.length} options on ${attributeCode}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Attribute Sets (Families)
  // ---------------------------------------------------------------------------

  /**
   * Creates or finds a Magento Attribute Set corresponding to an Akeneo Family.
   * Uses the family's English label (or code) as the attribute set name.
   *
   * @returns The Magento attribute_set_id as a string.
   */
  async upsertAttributeSet(family: Family): Promise<string> {
    const setName = this.getLabel(family.labels) || family.code;
    const id = await this.attributeService.resolveAttributeSetId(setName);

    // Cache by family code for later use in assignAttributesToSet
    MagentoSchemaService.attributeSetIdCache.set(family.code, id);

    this.logger.debug(`Upserted attribute set "${setName}" (ID: ${id}) for family ${family.code}`);
    return String(id);
  }

  // ---------------------------------------------------------------------------
  // 4. Assign Attributes to Sets
  // ---------------------------------------------------------------------------

  /**
   * Assigns a list of attribute codes to a Magento attribute set.
   * Fetches the "General" attribute group within the set and assigns there.
   *
   * @param attributeSetId - The Magento attribute_set_id (as string).
   * @param attributeCodes - List of attribute codes to assign.
   */
  async assignAttributesToSet(attributeSetId: string, attributeCodes: string[]): Promise<void> {
    const setId = Number(attributeSetId);

    // Get the attribute groups for this set to find the "General" group
    const groupId = await this.resolveGeneralGroupId(setId);
    if (!groupId) {
      this.logger.warn(`Could not find attribute group for set ${setId} — skipping assignment.`);
      return;
    }

    let assigned = 0;
    let skipped = 0;

    for (const code of attributeCodes) {
      try {
        await this.attributeService.assignAttributeToSet(code, setId, groupId);
        assigned++;
      } catch (error: any) {
        if (error.message?.includes("already")) {
          skipped++;
        } else {
          this.logger.debug(`Could not assign ${code} to set ${setId}:`, error);
          skipped++;
        }
      }
    }

    this.logger.debug(
      `Set ${setId}: assigned ${assigned}, skipped ${skipped} of ${attributeCodes.length} attributes.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetches the current options for an attribute to detect duplicates.
   */
  private async getExistingOptions(attributeCode: string): Promise<any[]> {
    try {
      const encoded = encodeURIComponent(attributeCode);
      return await this.client.get<any[]>(`/V1/products/attributes/${encoded}/options`);
    } catch {
      return [];
    }
  }

  /**
   * Resolves the "General" attribute group ID within an attribute set.
   * Falls back to the first group if "General" is not found.
   */
  private async resolveGeneralGroupId(attributeSetId: number): Promise<number | null> {
    try {
      const groups = await this.client.get<any[]>(
        `/V1/products/attribute-sets/${attributeSetId}/groups`,
      );
      if (!groups || groups.length === 0) return null;

      const general = groups.find(
        (g: any) =>
          g.attribute_group_name?.toLowerCase().includes("general") ||
          g.attribute_group_code?.toLowerCase().includes("general"),
      );
      return (general || groups[0]).attribute_group_id;
    } catch (error) {
      this.logger.debug(`Could not fetch groups for attribute set ${attributeSetId}:`, error);
      return null;
    }
  }

  /**
   * Returns the English label from a labels map, falling back to the first available.
   */
  private getLabel(labels: Record<string, string>): string | null {
    if (!labels) return null;
    return (
      labels["en_US"] ||
      labels["en_GB"] ||
      labels["en"] ||
      Object.values(labels)[0] ||
      null
    );
  }

  /**
   * Converts a labels Record into Magento store_labels format.
   * Store ID 0 = Admin (default). Per-store labels handled by localeMap in config.
   */
  private buildStoreLabels(labels: Record<string, string>): { store_id: number; label: string }[] {
    const storeLabels: { store_id: number; label: string }[] = [];
    const englishLabel = this.getLabel(labels);
    if (englishLabel) {
      storeLabels.push({ store_id: 0, label: englishLabel });
    }
    return storeLabels;
  }

  /**
   * Maps an Akeneo attribute type to a Magento frontend_input type.
   */
  private mapAkeneoTypeToMagentoInput(akeneoType: string): string {
    const typeMap: Record<string, string> = {
      pim_catalog_identifier: "text",
      pim_catalog_text: "text",
      pim_catalog_textarea: "textarea",
      pim_catalog_simpleselect: "select",
      pim_catalog_multiselect: "multiselect",
      pim_catalog_boolean: "boolean",
      pim_catalog_number: "text",
      pim_catalog_date: "date",
      pim_catalog_image: "media_image",
      pim_catalog_file: "text",
      pim_catalog_metric: "text",
      pim_catalog_price_collection: "price",
      pim_catalog_asset_collection: "text",
    };
    return typeMap[akeneoType] || "text";
  }
}
