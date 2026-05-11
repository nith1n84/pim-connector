import { AttributeValue, Category, Product, ProductVariant } from "@pim-connector/core";
import { VendureConfig } from "../types/vendure.types.js";

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
  mapToCreateProductInput(product: Product, assetIds: string[]) {
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
      assetIds,
      featuredAssetId: assetIds.length > 0 ? assetIds[0] : undefined,
      // customFields: { externalId: product.id } // Optional: if externalId custom field exists
    };
  }

  /**
   * Map CDM Product to Vendure UpdateProductInput
   */
  mapToUpdateProductInput(vendureId: string, product: Product, assetIds: string[]) {
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
      assetIds,
      featuredAssetId: assetIds.length > 0 ? assetIds[0] : undefined,
    };
  }

  /**
   * Map CDM Variant to Vendure CreateProductVariantInput
   */
  mapToCreateVariantInput(
    productId: string,
    variant: ProductVariant,
    optionIdMap: Map<string, string> = new Map(),
  ) {
    const nameTranslations = this.mapTranslations(variant.name, variant.sku || "Unknown Product");

    const translations = nameTranslations.map((nameTrans, index) => {
      return {
        languageCode: nameTrans.languageCode,
        name: nameTrans.name,
      };
    });

    const input: any = {
      productId,
      sku: variant.sku,
      price: 0,
      stockOnHand: 0,
      translations: translations,
    };

    // Add option values if present, mapping Akeneo option codes to Vendure option IDs
    if (variant.optionValues && variant.optionValues.length > 0) {
      input.optionIds = variant.optionValues.map(
        (ov) => optionIdMap.get(ov.optionId) || ov.optionId,
      );
    }

    return input;
  }

  /**
   * Map CDM Variant to Vendure UpdateProductVariantInput
   */
  mapToUpdateVariantInput(
    variantId: string,
    variant: ProductVariant,
    optionIdMap: Map<string, string> = new Map(),
  ) {
    const nameTranslations = this.mapTranslations(variant.name, variant.sku || "Unknown Variant");

    const input: any = {
      id: variantId,
      sku: variant.sku,
      price: variant.prices[0]?.amount || 0,
      translations: nameTranslations.map((trans) => ({
        languageCode: trans.languageCode,
        name: trans.name,
      })),
    };

    // Add option values if present, mapping Akeneo option codes to Vendure option IDs
    if (variant.optionValues && variant.optionValues.length > 0) {
      input.optionIds = variant.optionValues.map(
        (ov) => optionIdMap.get(ov.optionId) || ov.optionId,
      );
    }

    return input;
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

  /**
   * Map CDM Category to Vendure CreateCollectionInput
   */
  mapToCreateCollectionInput(category: Category, parentId: string | null) {
    const translations = this.mapCategoryTranslations(category.name);

    // Root collections should have parentId set to the Vendure root collection (id: null)
    const effectiveParentId = parentId ?? null;

    return {
      parentId: effectiveParentId,
      // slug: category.code,
      // name: category.name,
      translations,
      isPrivate: false,
      filters: [],
    };
  }

  /**
   * Map CDM Category to Vendure UpdateCollectionInput
   */
  mapToUpdateCollectionInput(vendureId: string, category: Category, parentId: string | null) {
    const translations = this.mapCategoryTranslations(category.name);

    const input: any = {
      id: vendureId,
      translations,
      isPrivate: false,
    };

    // Root collections should have parentId set to the Vendure root collection (id: "1")
    input.parentId = parentId ?? "1";

    return input;
  }

  /**
   * Map category labels to Vendure translation format
   */
  private mapCategoryTranslations(labels: Record<string, string>): Array<{
    languageCode: string;
    name: string;
    description: string;
    slug?: string;
  }> {
    const translations: Array<{
      languageCode: string;
      name: string;
      description: string;
      slug?: string;
    }> = [];

    for (const [locale, name] of Object.entries(labels)) {
      const languageCode = this.config.localeMap?.[locale] || locale.split("_")[0];
      translations.push({
        languageCode,
        name,
        description: "", // Vendure requires description field
        slug: this.sluggify(name),
      });
    }

    // Fallback if no translations
    if (translations.length === 0) {
      translations.push({
        languageCode: "en",
        name: "Unnamed Collection",
        description: "",
        slug: "unnamed-collection",
      });
    }

    return translations;
  }
}
