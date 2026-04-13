import { Product, Asset } from '@pim-connector/core';
import { AkeneoProduct, AkeneoAttributeValue } from './akeneo.types.js';

export class AkeneoMapper {
  constructor(private locale: string = 'en_US', private scope: string | null = null) {}

  /**
   * Map an Akeneo product response to the Canonical Data Model (CDM) Product.
   */
  mapToProduct(akeneoProduct: AkeneoProduct): Product {
    return {
      id: akeneoProduct.identifier,
      sku: akeneoProduct.identifier,
      name: this.getAttributeValue(akeneoProduct, 'name') || akeneoProduct.identifier,
      description: this.getAttributeValue(akeneoProduct, 'description') || '',
      enabled: akeneoProduct.enabled,
      categories: akeneoProduct.categories || [],
      attributes: this.mapAllAttributes(akeneoProduct),
      variants: [], // Simple products only for now
      assets: this.mapAssets(akeneoProduct),
    };
  }

  /**
   * Helper to extract an attribute value based on locale and scope.
   */
  private getAttributeValue(product: AkeneoProduct, attributeCode: string): any {
    const values = product.values[attributeCode];
    if (!values || values.length === 0) return null;

    // Filter by locale and scope
    const match = values.find(
      (v) => (v.locale === null || v.locale === this.locale) && 
             (v.scope === null || v.scope === this.scope)
    );

    return match ? match.data : null;
  }

  /**
   * Map all attribute values to a flat record.
   */
  private mapAllAttributes(product: AkeneoProduct): Record<string, any> {
    const attributes: Record<string, any> = {};
    for (const [code, values] of Object.entries(product.values)) {
      attributes[code] = this.getAttributeValue(product, code);
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
