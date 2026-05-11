import {
  Asset,
  AttributeValue,
  Category,
  OptionGroup,
  Product,
  ProductVariant,
} from "@pim-connector/core";
import {
  AkeneoAttributeValue,
  AkeneoCategory,
  AkeneoFamilyVariant,
  AkeneoProduct,
  AkeneoProductModel,
} from "../types/akeneo.types.js";

export class AkeneoMapper {
  private optionGroups: OptionGroup[] = [];

  constructor(
    private locales: string[] = ["en_US"],
    private scopes: string[] | null = null,
  ) {}

  setOptionGroups(optionGroups: OptionGroup[]) {
    this.optionGroups = optionGroups;
  }

  getOptionGroups() {
    return this.optionGroups;
  }

  mapVariantsToProduct(
    model: AkeneoProductModel,
    familyVariant: AkeneoFamilyVariant,
    variants: AkeneoProduct[],
    familyMapping: { labelAttribute: string; imageAttribute: string | null },
    optionGroups?: OptionGroup[],
  ): Product | null {
    const labelAttribute = familyMapping?.labelAttribute || "name";
    const imageAttribute = familyMapping?.imageAttribute || null;

    const productVariants: ProductVariant[] = [];

    variants.forEach((variant) => {
      const optionValues = this.extractVariantOptionValues(variant, familyVariant);

      productVariants.push({
        id: variant.identifier,
        sku: variant.identifier,
        name: this.mapAttribute(variant.values, labelAttribute) || variants[0].identifier,
        prices: [
          {
            amount: 0,
            currency: "AED",
          },
        ],
        attributes: this.mapAllAttributes(variant.values),
        assets: [],
        optionValues,
        categories: variant.categories ?? [],
      });
    });

    return {
      id: model.code,
      sku: variants[0].identifier,
      name: [{ locale: null, value: model.code, type: "pim_catalog_text", scope: null }],
      description: this.mapAttribute(model.values, "description") || "",
      enabled: true,
      categories: model.categories || [],
      attributes: this.mapAllAttributes(model.values),
      variants: productVariants,
      assets: [],
      optionGroups: optionGroups,
    };
  }

  /**
   * Map an Akeneo product response to the Canonical Data Model (CDM) Product.
   */
  mapToProduct(
    akeneoProduct: AkeneoProduct,
    mediaFiles?: any[],
    familyMapping?: { labelAttribute: string; imageAttribute: string | null },
  ): Product {
    const labelAttribute = familyMapping?.labelAttribute || "name";

    return {
      id: akeneoProduct.identifier,
      sku: akeneoProduct.identifier,
      name: this.mapAttribute(akeneoProduct.values, labelAttribute) || akeneoProduct.identifier,
      description: this.mapAttribute(akeneoProduct.values, "description") || "",
      enabled: akeneoProduct.enabled,
      categories: akeneoProduct.categories || [],
      attributes: this.mapAllAttributes(akeneoProduct.values),
      variants: [],
      assets: mediaFiles ? this.mapAssets(mediaFiles) : [],
    };
  }

  private mapAttribute(
    attributes: Record<string, AkeneoAttributeValue[]>,
    attributeCode: string,
  ): AttributeValue[] {
    const values = attributes[attributeCode];
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
  private mapAllAttributes(
    attributes: Record<string, AkeneoAttributeValue[]>,
  ): Record<string, any> {
    const mappedAttributes: Record<string, any> = {};
    for (const [code, values] of Object.entries(attributes)) {
      mappedAttributes[code] = this.mapAttribute(attributes, code);
    }
    return mappedAttributes;
  }

  /**
   * Extract option values from variant based on family variant axes.
   */
  private extractVariantOptionValues(
    variant: AkeneoProduct,
    familyVariant: AkeneoFamilyVariant,
  ): { optionGroupId: string; optionId: string }[] {
    const optionValues: { optionGroupId: string; optionId: string }[] = [];

    // Get all axes from all variant attribute sets
    const allAxes = new Set<string>();
    for (const variantSet of familyVariant.variant_attribute_sets) {
      for (const axis of variantSet.axes) {
        allAxes.add(axis);
      }
    }

    // Extract values for each axis, but only if the variant has a value for that axis
    for (const axis of allAxes) {
      const attributeValues = variant.values[axis];
      if (attributeValues && attributeValues.length > 0) {
        // Get the first value that matches our locale/scope criteria
        const value = this.findBestAttributeValue(attributeValues);
        if (value && value.data) {
          let optionId;
          if (value.attribute_type === "pim_catalog_metric") {
            optionId = `${value.data.amount} ${value.data.unit}`;
          } else {
            optionId = String(value.data);
          }
          optionValues.push({
            optionGroupId: axis,
            optionId: optionId,
          });
        }
      }
    }

    return optionValues;
  }

  /**
   * Find the best attribute value based on locale and scope preferences.
   */
  private findBestAttributeValue(values: AkeneoAttributeValue[]): AkeneoAttributeValue | null {
    for (const v of values) {
      // locale filter
      const localeOk = !v.locale || this.locales.includes(v.locale);

      // scope filter
      const scopeOk = !v.scope || !this.scopes || this.scopes.includes(v.scope);

      if (localeOk && scopeOk) {
        return v;
      }
    }

    // Fallback to first value if none match
    return values.length > 0 ? values[0] : null;
  }

  /**
   * Map assets
   */
  private mapAssets(mediaFiles: any[]): Asset[] {
    return mediaFiles.map((media) => ({
      id: media.code,
      name: media.filename,
      buffer: media.buffer,
      mimeType: media.mimeType,
      type: "image" as const,
    }));
  }

  /**
   * Map an Akeneo category to the Canonical Data Model (CDM) Category.
   */
  mapToCategory(
    akeneoCategory: AkeneoCategory,
    categoryMap: Map<string, AkeneoCategory>,
    position: number,
  ): Category {
    // Map parent code to parent ID (using parent's code as ID for consistency)
    const parentId = akeneoCategory.parent ? akeneoCategory.parent : null;

    return {
      id: akeneoCategory.code, // Use code as ID for consistency
      code: akeneoCategory.code, // This maps to Vendure slug
      name: akeneoCategory.labels,
      parentId,
      position,
    };
  }
}
