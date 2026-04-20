import { AttributeValue, Product, ProductVariant } from "@pim-connector/core";
import { VendureConfig } from "./vendure.types.js";

export class VendureMapper {
  constructor(private config: VendureConfig = {} as VendureConfig) {}
  /**
   * Convert LocalizedString to Vendure TranslationInput format
   */
  private mapTranslations(
    attributes: AttributeValue[] | null | undefined,
    fallbackValue?: string,
  ): Array<{
    languageCode: string;
    name?: string;
    description?: string;
    slug?: string;
  }> {
    const translations: Array<{
      languageCode: string;
      name?: string;
      description?: string;
      slug?: string;
    }> = [];

    // Handle null/undefined input
    if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
      if (fallbackValue) {
        translations.push({
          languageCode: "en", // <-- todo: update with dynamic default languageCode
          name: fallbackValue,
        });
      }
      return translations;
    }

    for (const attr of attributes) {
      if (!attr?.value) continue;

      // map locale -> languageCode (with fallback handling)
      const languageCode =
        (attr.locale && this.config.localeMap?.[attr.locale]) ||
        (attr.locale ? attr.locale.split("_")[0] : "en");

      translations.push({
        languageCode,
        name: attr.value,
      });
    }

    // Fallback if nothing valid was mapped
    if (translations.length === 0 && fallbackValue) {
      translations.push({
        languageCode: "en",
        name: fallbackValue,
      });
    }

    return translations;
  }

  /**
   * Map CDM Product to Vendure CreateProductInput
   */
  mapToCreateProductInput(product: Product) {
    const nameTranslations = this.mapTranslations(product.name, product.sku || "Unknown Product");
    const descriptionTranslations = this.mapTranslations(product.description, "");

    // Merge name and description translations
    const translations = nameTranslations.map((nameTrans, index) => {
      const descTrans = descriptionTranslations[index];
      return {
        languageCode: nameTrans.languageCode,
        name: nameTrans.name,
        slug: this.sluggify(nameTrans.name || product.sku || ""),
        description: descTrans?.name || "",
      };
    });

    return {
      enabled: product.enabled,
      translations,
      // customFields: { externalId: product.id } // Optional: if externalId custom field exists
    };
  }

  /**
   * Map CDM Product to Vendure UpdateProductInput
   */
  mapToUpdateProductInput(vendureId: string, product: Product) {
    const nameTranslations = this.mapTranslations(product.name, product.sku || "Unknown Product");
    const descriptionTranslations = this.mapTranslations(product.description, "");

    // Merge name and description translations
    const translations = nameTranslations.map((nameTrans, index) => {
      const descTrans = descriptionTranslations[index];
      return {
        languageCode: nameTrans.languageCode,
        name: nameTrans.name,
        slug: this.sluggify(nameTrans.name || product.sku || ""),
        description: descTrans?.name || "",
      };
    });

    return {
      id: vendureId,
      enabled: product.enabled,
      translations,
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
          languageCode: "en",
          name: variant.name,
        },
      ],
    };
  }

  /**
   * Map CDM Variant to Vendure UpdateProductVariantInput
   */
  mapToUpdateVariantInput(variantId: string, variant: ProductVariant) {
    const nameTranslations = this.mapTranslations(variant.name, variant.sku || "Unknown Variant");

    return {
      id: variantId,
      sku: variant.sku,
      price: variant.prices[0]?.amount || 0,
      translations: nameTranslations.map((trans) => ({
        languageCode: trans.languageCode,
        name: trans.name,
      })),
    };
  }

  /**
   * Map channel assignments for variants
   */
  mapAssignVariantsToChannelInput(productVariantIds: string[], channelId: string) {
    return {
      productVariantIds,
      channelId,
    };
  }

  /**
   * Map CDM attributes to Vendure ProductAttribute inputs
   */
  mapToProductAttributeInputs(
    productId: string,
    attributes: Record<string, AttributeValue[]>,
    options?: {
      includeAttributes?: string[];
      excludeAttributes?: string[];
    },
  ) {
    const inputs: any[] = [];

    for (const [code, values] of Object.entries(attributes)) {
      // Apply filters
      if (options?.includeAttributes && !options.includeAttributes.includes(code)) continue;
      if (options?.excludeAttributes && options.excludeAttributes.includes(code)) continue;

      for (const attr of values) {
        // Resolve locale
        let targetLocale: string | null = null;
        if (attr.locale) {
          targetLocale = this.config.localeMap?.[attr.locale] || attr.locale.split("_")[0];
          // If we have a locale map and this locale isn't in it, we might want to skip or fallback
          // For now, we'll use the mapping or the short language code
        }

        // Resolve scope (channel)
        let targetScope: string | null = null;
        if (attr.scope) {
          targetScope = this.config.channelMap?.[attr.scope] || attr.scope;
        }

        inputs.push({
          productId,
          code,
          value: attr.value,
          type: attr.type,
          locale: targetLocale,
          scope: targetScope,
        });
      }
    }

    return inputs;
  }

  private sluggify(text: string): string {
    if (!text) return "product-" + Math.random().toString(36).substring(7);
    return text
      .toLowerCase()
      .replace(/[^\w ]+/g, "")
      .replace(/ +/g, "-");
  }
}
