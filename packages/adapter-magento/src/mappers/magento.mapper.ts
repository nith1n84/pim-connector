import { AttributeValue, Category, Product, ProductVariant } from "@pim-connector/core";
import { MagentoConfig } from "../types/magento.types.js";

/**
 * Maps Canonical Data Model (CDM) entities to Magento 2 REST API payloads.
 *
 * Localization strategy:
 *  - Base product data (sku, attribute_set_id, type_id, status, non-localized attrs) →
 *    written once to the "all" store scope.
 *  - Localized fields (name, description, custom_attributes with locale values) →
 *    written separately per store view using localeMap.
 */
export class MagentoMapper {
  constructor(private readonly config: MagentoConfig) {}

  // ---------------------------------------------------------------------------
  // Product mapping
  // ---------------------------------------------------------------------------

  /**
   * Maps a CDM Product to a Magento base product payload (store-scope: "all").
   * @param product - The CDM product.
   * @param attributeSetId - The resolved Magento attribute_set_id.
   * @param typeId - "simple" or "configurable".
   */
  mapToBaseProductPayload(
    product: Product,
    attributeSetId: number,
    typeId: "simple" | "configurable" = "simple",
  ): Record<string, unknown> {
    const sku = product.sku || product.id;

    const customAttributes = this.mapCustomAttributes(product.attributes, null, null);

    // Name fallback: pick first non-null name value
    const fallbackName = this.getFirstValue(product.name) || sku;

    return {
      product: {
        sku,
        name: fallbackName,
        attribute_set_id: attributeSetId,
        status: product.enabled ? 1 : 2,
        type_id: typeId,
        weight: 1,
        custom_attributes: customAttributes,
      },
    };
  }

  /**
   * Maps a CDM Product to a localized payload for a specific store view.
   * Only localized fields (name, description, custom_attributes with locale) are included.
   * @param product - The CDM product.
   * @param locale - The Akeneo locale code (e.g. "fr_FR").
   */
  mapToLocalizedProductPayload(
    product: Product,
    locale: string,
  ): Record<string, unknown> {
    const sku = product.sku || product.id;

    const localizedName = this.getValueForLocale(product.name, locale) || sku;
    const localizedDescription = this.getValueForLocale(product.description, locale) || "";

    const localizedCustomAttributes = this.mapCustomAttributes(
      product.attributes,
      locale,
      null, // scope — pass null to include all scopes; filter per locale
    );

    return {
      product: {
        sku,
        name: localizedName,
        custom_attributes: [
          { attribute_code: "description", value: localizedDescription },
          { attribute_code: "short_description", value: localizedDescription },
          ...localizedCustomAttributes,
        ],
      },
    };
  }

  /**
   * Maps a CDM ProductVariant to a Magento simple product payload.
   */
  mapToVariantPayload(
    variant: ProductVariant,
    attributeSetId: number,
    parentCategories: string[] = [],
  ): Record<string, unknown> {
    const sku = variant.sku;
    const fallbackName = this.getFirstValue(variant.name) || sku;

    const customAttributes = this.mapCustomAttributes(variant.attributes, null, null);

    // Inject configurable axis attribute values (e.g. size, color)
    for (const [code, values] of Object.entries(variant.attributes || {})) {
      if (!customAttributes.find((a: any) => a.attribute_code === code)) {
        const val = this.getFirstValue(values);
        if (val) customAttributes.push({ attribute_code: code, value: val });
      }
    }

    return {
      product: {
        sku,
        name: fallbackName,
        attribute_set_id: attributeSetId,
        type_id: "simple",
        status: 1,
        weight: 1,
        visibility: 1, // Not individually visible
        custom_attributes: customAttributes,
        extension_attributes: {
          category_links: parentCategories.map((catId, i) => ({
            position: i,
            category_id: catId,
          })),
        },
      },
    };
  }

  /**
   * Maps a CDM ProductVariant to a localized simple product payload.
   */
  mapToLocalizedVariantPayload(
    variant: ProductVariant,
    locale: string,
  ): Record<string, unknown> {
    const localizedName = this.getValueForLocale(variant.name, locale) || variant.sku;

    return {
      product: {
        sku: variant.sku,
        name: localizedName,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Category mapping
  // ---------------------------------------------------------------------------

  /**
   * Maps a CDM Category to a Magento category creation payload.
   * @param category - The CDM category.
   * @param parentMagentoId - The resolved Magento parent category ID.
   */
  mapToCreateCategoryPayload(
    category: Category,
    parentMagentoId: number,
  ): Record<string, unknown> {
    const defaultLocale = this.getDefaultLocale();
    const name =
      (defaultLocale && category.name[defaultLocale]) ||
      Object.values(category.name)[0] ||
      category.code;

    return {
      category: {
        parent_id: parentMagentoId,
        name,
        is_active: true,
        include_in_menu: true,
        custom_attributes: [
          { attribute_code: "url_key", value: this.sluggify(name) },
          { attribute_code: "url_path", value: this.sluggify(name) },
          { attribute_code: "display_mode", value: "PRODUCTS" },
          { attribute_code: "is_anchor", value: "1" },
        ],
      },
    };
  }

  /**
   * Maps a CDM Category to a Magento category update payload.
   */
  mapToUpdateCategoryPayload(
    categoryId: number,
    category: Category,
    parentMagentoId: number,
  ): Record<string, unknown> {
    const base = this.mapToCreateCategoryPayload(category, parentMagentoId);
    return {
      category: {
        ...(base as any).category,
        id: categoryId,
      },
    };
  }

  /**
   * Builds a localized category payload for a specific store view.
   */
  mapToLocalizedCategoryPayload(
    categoryId: number,
    category: Category,
    locale: string,
  ): Record<string, unknown> {
    const localizedName = category.name[locale] || Object.values(category.name)[0] || category.code;

    return {
      category: {
        id: categoryId,
        name: localizedName,
        custom_attributes: [
          { attribute_code: "url_key", value: this.sluggify(localizedName) },
        ],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Configurable product link payload
  // ---------------------------------------------------------------------------

  /**
   * Builds the super_attributes payload for a configurable product.
   * @param configurableAttrCodes - List of attribute codes that are axes (e.g. ["size", "color"]).
   * @param attrCodeToId - Map from attribute_code → attribute_id.
   */
  mapToConfigurableOptions(
    parentSku: string,
    configurableAttrCodes: string[],
    attrCodeToId: Map<string, number>,
  ): unknown[] {
    return configurableAttrCodes
      .map((code, position) => {
        const attributeId = attrCodeToId.get(code);
        if (!attributeId) return null;
        return {
          attribute_id: String(attributeId),
          label: code,
          position,
          is_use_default: false,
          values: [], // Magento auto-derives from linked children
        };
      })
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts CDM attributes (Record<code, AttributeValue[]>) to Magento
   * custom_attributes array, filtering by locale/scope when provided.
   */
  private mapCustomAttributes(
    attributes: Record<string, AttributeValue[]> | undefined,
    locale: string | null,
    scope: string | null,
  ): Array<{ attribute_code: string; value: string }> {
    if (!attributes) return [];

    const result: Array<{ attribute_code: string; value: string }> = [];

    for (const [code, values] of Object.entries(attributes)) {
      if (!values || values.length === 0) continue;

      // When locale is specified, pick value for that locale
      const value = locale
        ? this.getValueForLocale(values, locale)
        : this.getFirstValue(values);

      if (value !== null && value !== undefined && value !== "") {
        result.push({ attribute_code: code, value: String(value) });
      }
    }

    return result;
  }

  /**
   * Returns the attribute value for a specific locale, falling back to the
   * first non-locale value if not found.
   */
  private getValueForLocale(
    values: AttributeValue[] | undefined | null,
    locale: string,
  ): string | null {
    if (!values || values.length === 0) return null;

    // Exact locale match
    const exact = values.find((v) => v.locale === locale);
    if (exact?.value) return exact.value;

    // Language-only match (e.g. "en" matches "en_US")
    const lang = locale.split("_")[0];
    const langMatch = values.find((v) => v.locale?.startsWith(lang));
    if (langMatch?.value) return langMatch.value;

    // Fall back to non-localized (locale === null)
    const nonLocalized = values.find((v) => v.locale === null);
    if (nonLocalized?.value) return nonLocalized.value;

    return null;
  }

  /** Returns the first non-empty string value in an AttributeValue array. */
  private getFirstValue(values: AttributeValue[] | undefined | null): string | null {
    if (!values || values.length === 0) return null;
    for (const v of values) {
      if (v?.value) return v.value;
    }
    return null;
  }

  /** Returns the first locale code in localeMap, or null. */
  private getDefaultLocale(): string | null {
    const localeMap = this.config.localeMap;
    if (!localeMap) return null;
    return Object.keys(localeMap)[0] ?? null;
  }

  /** Converts a string to a Magento-compatible URL key. */
  sluggify(text: string): string {
    if (!text) return "category-" + Math.random().toString(36).substring(7);
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}
