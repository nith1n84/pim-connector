import { Family, Logger } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";

/**
 * Service for fetching Akeneo Families and building CDM Family objects.
 *
 * Each Akeneo Family maps to a Magento Attribute Set.
 * This service also fetches the full list of attribute codes per family
 * so the schema sync can assign them to the correct attribute set.
 */
export class AkeneoFamilyService {
  constructor(
    private readonly client: AkeneoClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetches all Akeneo families and enriches each with the full list of
   * attribute codes that belong to it.
   *
   * @returns Array of CDM Family objects ready for Magento attribute set creation.
   */
  async getAllFamilies(): Promise<Family[]> {
    this.logger.debug("Fetching all Akeneo families...");
    const akeneoFamilies = await this.client.getFamilies();
    this.logger.debug(`Found ${akeneoFamilies.length} families. Fetching their attributes...`);

    const families: Family[] = [];

    for (const akeneoFamily of akeneoFamilies) {
      try {
        // Fetch all attribute codes that belong to this family
        const attributeCodes = await this.client.getFamilyAttributes(akeneoFamily.code);

        families.push({
          code: akeneoFamily.code,
          labels: akeneoFamily.labels || {},
          attributeCodes,
          attributeAsLabel: akeneoFamily.attribute_as_label || "name",
          attributeAsImage: akeneoFamily.attribute_as_image || null,
        });

        this.logger.debug(
          `Family "${akeneoFamily.code}": ${attributeCodes.length} attributes`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch attributes for family "${akeneoFamily.code}":`,
          error,
        );
      }
    }

    return families;
  }
}
