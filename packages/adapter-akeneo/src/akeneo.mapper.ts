import { Asset, AttributeDefinition, AttributeValue, Product } from "@pim-connector/core";
import { AkeneoProduct } from "./akeneo.types.js";

export class AkeneoMapper {
  private attributeDefinitions: Map<string, AttributeDefinition> = new Map();
  private familyMappings: Map<string, { labelAttribute: string; imageAttribute: string | null }> =
    new Map();

  constructor(
    private locales: string[] = ["en_US"],
    private scopes: string[] | null = null,
  ) {}

  setAttributeDefinitions(definitions: Map<string, AttributeDefinition>) {
    this.attributeDefinitions = definitions;
  }

  setFamilyMappings(
    mappings: Map<string, { labelAttribute: string; imageAttribute: string | null }>,
  ) {
    this.familyMappings = mappings;
  }

  /**
   * Map an Akeneo product response to the Canonical Data Model (CDM) Product.
   */
  mapToProduct(
    akeneoProduct: AkeneoProduct,
    familyMapping?: { labelAttribute: string; imageAttribute: string | null },
  ): Product {
    const labelAttribute = familyMapping?.labelAttribute || "name";
    const imageAttribute = familyMapping?.imageAttribute || null;

    return {
      id: akeneoProduct.identifier,
      sku: akeneoProduct.identifier,
      name: this.mapAttribute(akeneoProduct, labelAttribute) || akeneoProduct.identifier,
      description: this.mapAttribute(akeneoProduct, "description") || "",
      enabled: akeneoProduct.enabled,
      categories: akeneoProduct.categories || [],
      attributes: this.mapAllAttributes(akeneoProduct),
      variants: [], // Simple products only for now
      assets: this.mapAssets(akeneoProduct),
    };
  }

  private mapAttribute(entity: AkeneoProduct, attributeCode: string): AttributeValue[] {
    const values = entity.values[attributeCode];
    if (!values || values.length === 0) return [];

    const result: AttributeValue[] = [];

    for (const v of values) {
      // locale filter
      const localeOk = !v.locale || this.locales.includes(v.locale);

      // scope filter
      const scopeOk = !v.scope || !this.scopes || this.scopes.includes(v.scope);

      if (!localeOk || !scopeOk) continue;

      let attributeValue: AttributeValue = {
        value: "",
        type: "",
        locale: v.locale,
        scope: v.scope,
      };

      // Resolve attribute type from definition if not provided in the value object
      const type = v.attribute_type || this.attributeDefinitions.get(attributeCode)?.akeneoType;

      // todo: revisit the mapping of attribute types to CDM types check all cases
      switch (type) {
        case "pim_catalog_identifier":
        case "pim_catalog_simpleselect":
        case "pim_catalog_text":
        case "pim_catalog_textarea":
          attributeValue.value = v.data ?? "";
          attributeValue.type = "string";
          break;
        case "pim_catalog_boolean":
          attributeValue.value = String(v.data);
          attributeValue.type = "boolean";
          break;
        case "pim_catalog_number":
          attributeValue.value = String(v.data);
          attributeValue.type = "number";
          break;
        case "pim_catalog_date":
          attributeValue.value = v.data ?? "";
          attributeValue.type = "string";
          break;
        case "pim_catalog_multiselect":
        case "pim_catalog_asset_collection":
          attributeValue.value = Array.isArray(v.data) ? JSON.stringify(v.data) : String(v.data);
          attributeValue.type = "array";
          break;
        case "pim_catalog_metric":
          attributeValue.value = v.data ? JSON.stringify(v.data) : "";
          attributeValue.type = "object";
          break;
        case "pim_catalog_price_collection":
          attributeValue.value = v.data ? JSON.stringify(v.data) : "[]";
          attributeValue.type = "array";
          break;
        default:
          attributeValue.value = v.data
            ? typeof v.data === "object"
              ? JSON.stringify(v.data)
              : String(v.data)
            : "";
          attributeValue.type = typeof v.data === "object" ? "object" : typeof v.data;
          break;
      }
      result.push(attributeValue);
    }

    return result;
  }

  /**
   * Map all attribute values to a flat record.
   */
  private mapAllAttributes(product: AkeneoProduct): Record<string, any> {
    const attributes: Record<string, any> = {};
    for (const [code, values] of Object.entries(product.values)) {
      attributes[code] = this.mapAttribute(product, code);
    }
    return attributes;
  }

  /**
   * Map assets if available (placeholder for now).
   */
  private mapAssets(product: AkeneoProduct): Asset[] {
    // In Akeneo, assets are often stored in 'media_file' or 'image' attribute types
    // Or via the Asset Manager (which has a different API endpoint)
    // For now, we'll try to find common image attributes.
    return [];
  }
}
