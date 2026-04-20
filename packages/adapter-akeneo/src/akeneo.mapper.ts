import { Asset, AttributeValue, Product } from "@pim-connector/core";
import { AkeneoProduct } from "./akeneo.types.js";

export class AkeneoMapper {
  constructor(
    private locales: string[] = ["en_US"],
    private scopes: string[] | null = null,
  ) {}

  /**
   * Map an Akeneo product response to the Canonical Data Model (CDM) Product.
   */
  mapToProduct(akeneoProduct: AkeneoProduct): Product {
    return {
      id: akeneoProduct.identifier,
      sku: akeneoProduct.identifier,
      name: this.mapAttribute(akeneoProduct, "name") || akeneoProduct.identifier,
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

      // todo: revisit the mapping of attribute types to CDM types check all cases
      switch (v.attribute_type) {
        case "pim_catalog_identifier":
        case "pim_catalog_simpleselect":
        case "pim_catalog_text":
          attributeValue.value = v.data;
          attributeValue.type = "string";
          break;
        case "pim_catalog_boolean":
          attributeValue.value = v.data;
          attributeValue.type = "boolean";
          break;

        case "pim_catalog_multiselect":
        case "pim_catalog_asset_collection":
          attributeValue.value = v.data;
          attributeValue.type = "array";
          break;
        case "pim_catalog_metric":
          attributeValue.value = v.data ? JSON.stringify(v.data) : "";
          attributeValue.type = "string";
          break;
        default:
          attributeValue.value = v.data ? v.data.toString() : "";
          attributeValue.type = typeof v.data;
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
