import { Attribute, AttributeOption, AttributeOptionsGroup, Logger } from "@pim-connector/core";

/**
 * Akeneo attribute types that produce select options in Magento.
 */
const SELECT_TYPES = new Set([
  "pim_catalog_simpleselect",
  "pim_catalog_multiselect",
]);

/**
 * Service for fetching Akeneo Attributes and their Options.
 *
 * - Attributes → Magento Attributes (create before products)
 * - Attribute Options → Magento Attribute Options (select/multiselect values like S/M/L, Red/Blue)
 *
 * Results are deduplicated — if the same attribute code appears in multiple families
 * it is only fetched once.
 */
export class AkeneoAttributeService {
  constructor(
    private readonly client: any, // AkeneoClient
    private readonly logger: Logger,
  ) {}

  /**
   * Fetches all attributes used across the given families, deduplicated by code.
   *
   * @param familyCodes - List of family codes to scope the fetch.
   *   If empty, fetches ALL attributes from Akeneo.
   * @returns Deduplicated array of CDM Attribute objects.
   */
  async getAllAttributes(familyCodes?: string[]): Promise<Attribute[]> {
    this.logger.debug(
      familyCodes?.length
        ? `Fetching attributes for ${familyCodes.length} families...`
        : "Fetching all Akeneo attributes...",
    );

    // Collect all unique attribute codes across the given families
    let attributeCodesToFetch: string[] | undefined;

    if (familyCodes && familyCodes.length > 0) {
      const codeSet = new Set<string>();
      for (const familyCode of familyCodes) {
        try {
          const codes = await this.client.getFamilyAttributes(familyCode);
          codes.forEach((c: string) => codeSet.add(c));
        } catch (error) {
          this.logger.debug(`Could not fetch attributes for family ${familyCode}:`, error);
        }
      }
      attributeCodesToFetch = Array.from(codeSet);
      this.logger.debug(
        `Resolved ${attributeCodesToFetch.length} unique attribute codes across ${familyCodes.length} families.`,
      );
    }

    // Fetch full attribute definitions
    const raw = await this.client.getAllAttributes(attributeCodesToFetch);

    // Build family lookup: attributeCode → familyCodes[]
    const attrFamilyMap = new Map<string, string[]>();
    if (familyCodes && familyCodes.length > 0) {
      for (const familyCode of familyCodes) {
        const codes = await this.client.getFamilyAttributes(familyCode);
        for (const code of codes) {
          const existing = attrFamilyMap.get(code) || [];
          existing.push(familyCode);
          attrFamilyMap.set(code, existing);
        }
      }
    }

    return raw.map((a: any): Attribute => ({
      code: a.code,
      type: a.type,
      labels: a.labels || {},
      localizable: a.localizable ?? false,
      scopable: a.scopable ?? false,
      familyCodes: attrFamilyMap.get(a.code) || [],
    }));
  }

  /**
   * Fetches all options for the given select/multiselect attribute codes.
   *
   * @param attributeCodes - Codes of select/multiselect attributes.
   * @returns One AttributeOptionsGroup per attribute code that has options.
   */
  async getAttributeOptions(attributeCodes: string[]): Promise<AttributeOptionsGroup[]> {
    const result: AttributeOptionsGroup[] = [];

    for (const code of attributeCodes) {
      try {
        const rawOptions: any[] = [];
        for await (const items of this.client.paginate(`/api/rest/v1/attributes/${code}/options`)) {
          rawOptions.push(...(items as any[]));
        }

        if (rawOptions.length === 0) continue;

        const options: AttributeOption[] = rawOptions.map((o: any) => ({
          code: o.code,
          attributeCode: code,
          labels: o.labels || {},
          sortOrder: o.sort_order ?? 0,
        }));

        result.push({ attributeCode: code, options });
        this.logger.debug(`Attribute "${code}": ${options.length} options`);
      } catch (error) {
        this.logger.debug(`No options for attribute ${code} (may not be select type):`, error);
      }
    }

    return result;
  }
}
