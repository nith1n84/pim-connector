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

      result.push({
        value: v.data ? String(v.data) : "",
        label: v.data ? String(v.data) : "", // adjust if you have a real label source
        type: typeof v.data,
        locale: v.locale,
        scope: v.scope,
      });
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
