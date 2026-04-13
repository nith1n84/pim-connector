import { Product, ProductVariant } from '@pim-connector/core';

export class VendureMapper {
  /**
   * Map CDM Product to Vendure CreateProductInput
   */
  mapToCreateProductInput(product: Product) {
    return {
      enabled: product.enabled,
      translations: [
        {
          languageCode: 'en', // Hardcoded for now as per requirements
          name: product.name,
          slug: this.sluggify(product.name),
          description: product.description,
        },
      ],
      // customFields: { externalId: product.id } // Optional: if externalId custom field exists
    };
  }

  /**
   * Map CDM Product to Vendure UpdateProductInput
   */
  mapToUpdateProductInput(vendureId: string, product: Product) {
    return {
      id: vendureId,
      enabled: product.enabled,
      translations: [
        {
          languageCode: 'en',
          name: product.name,
          slug: this.sluggify(product.name),
          description: product.description,
        },
      ],
    };
  }

  /**
   * Map CDM Variant to Vendure CreateProductVariantInput
   */
  mapToCreateVariantInput(productId: string, variant: ProductVariant) {
    return {
      productId,
      sku: variant.sku,
      price: variant.prices[0]?.amount || 0,
      translations: [
        {
          languageCode: 'en',
          name: variant.name,
        },
      ],
    };
  }

  /**
   * Map CDM Variant to Vendure UpdateProductVariantInput
   */
  mapToUpdateVariantInput(variantId: string, variant: ProductVariant) {
    return {
      id: variantId,
      sku: variant.sku,
      price: variant.prices[0]?.amount || 0,
      translations: [
        {
          languageCode: 'en',
          name: variant.name,
        },
      ],
    };
  }

  private sluggify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-');
  }
}
