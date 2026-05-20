import { Logger, Product, ProductVariant } from "@pim-connector/core";
import { MagentoClient } from "../client/magento.client.js";
import { MagentoMapper } from "../mappers/magento.mapper.js";
import { MagentoAttributeService } from "./magento-attribute.service.js";
import { MagentoMediaService } from "./magento-media.service.js";
import { MagentoConfig } from "../types/magento.types.js";
import { MagentoProduct } from "../types/magento.types.js";

/**
 * Service for synchronising CDM Products into Magento.
 *
 * Handles:
 *  1. Attribute set resolution (Akeneo family → Magento attribute set).
 *  2. Configurable vs simple product detection.
 *  3. Base product write to all-store scope.
 *  4. Localized field writes per store view (localeMap).
 *  5. Variant (children) creation + configurable product option linking.
 *  6. Media synchronisation.
 */
export class MagentoProductService {
  constructor(
    private readonly client: MagentoClient,
    private readonly mapper: MagentoMapper,
    private readonly attributeService: MagentoAttributeService,
    private readonly mediaService: MagentoMediaService,
    private readonly config: MagentoConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates or updates a product and all its variants in Magento.
   * @param product - The CDM product.
   * @param targetSku - Existing Magento SKU (from identity map) if known.
   * @returns The product's SKU (used as the stable identity key in Magento).
   */
  async upsertProduct(product: Product, targetSku?: string): Promise<string> {
    const sku = product.sku || product.id;
    if (!sku) {
      this.logger.warn("Product has no SKU — skipping.");
      return "";
    }

    // 1. Resolve attribute set
    const attributeSetName = this.resolveAttributeSetName(product);
    const attributeSetId = await this.attributeService.resolveAttributeSetId(attributeSetName);

    // 2. Determine product type
    const hasVariants = product.variants && product.variants.length > 0;
    const typeId: "simple" | "configurable" = hasVariants ? "configurable" : "simple";

    // 3. Upsert base product (all-store scope)
    const existing = await this.getProductBySku(targetSku ?? sku);
    if (existing) {
      await this.updateBaseProduct(product, attributeSetId, typeId);
    } else {
      await this.createBaseProduct(product, attributeSetId, typeId);
    }

    // 4. Localized fields → per store view
    await this.pushLocalizedProductFields(product);

    // 5. Media
    if (product.assets && product.assets.length > 0) {
      await this.mediaService.syncMedia(sku, product.assets);
    }

    // 6. Variants (configurable product flow)
    if (hasVariants) {
      await this.upsertVariants(product, attributeSetId);
      await this.linkConfigurableOptions(product);
    }

    return sku;
  }

  // ---------------------------------------------------------------------------
  // Base product
  // ---------------------------------------------------------------------------

  private async createBaseProduct(
    product: Product,
    attributeSetId: number,
    typeId: "simple" | "configurable",
  ): Promise<void> {
    const payload = this.mapper.mapToBaseProductPayload(product, attributeSetId, typeId);
    await this.client.post<MagentoProduct>("/V1/products", payload);
    this.logger.debug(`Created Magento product: ${product.sku}`);
  }

  private async updateBaseProduct(
    product: Product,
    attributeSetId: number,
    typeId: "simple" | "configurable",
  ): Promise<void> {
    const sku = encodeURIComponent(product.sku || product.id);
    const payload = this.mapper.mapToBaseProductPayload(product, attributeSetId, typeId);
    await this.client.put<MagentoProduct>(`/V1/products/${sku}`, payload);
    this.logger.debug(`Updated Magento product: ${product.sku}`);
  }

  private async getProductBySku(sku: string): Promise<MagentoProduct | null> {
    try {
      return await this.client.get<MagentoProduct>(
        `/V1/products/${encodeURIComponent(sku)}`,
      );
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Localized fields
  // ---------------------------------------------------------------------------

  /**
   * Pushes localized product name + description to each store view in localeMap.
   * The default store view is skipped because the base write already covers it.
   */
  private async pushLocalizedProductFields(product: Product): Promise<void> {
    const localeMap = this.config.localeMap;
    if (!localeMap) return;

    const defaultStoreCode = this.config.storeCode ?? "default";

    for (const [locale, storeCode] of Object.entries(localeMap)) {
      if (storeCode === defaultStoreCode) continue; // already written in base payload

      const payload = this.mapper.mapToLocalizedProductPayload(product, locale);
      const encodedSku = encodeURIComponent(product.sku || product.id);

      try {
        await this.client.put<MagentoProduct>(`/V1/products/${encodedSku}`, payload, storeCode);
        this.logger.debug(
          `Pushed localized fields for ${product.sku} → store view "${storeCode}"`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to push localized fields for ${product.sku} / store "${storeCode}":`,
          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------------------

  /**
   * Creates or updates all simple product variants and links them to the
   * configurable parent.
   */
  private async upsertVariants(product: Product, attributeSetId: number): Promise<void> {
    const parentSku = product.sku || product.id;

    for (const variant of product.variants) {
      try {
        await this.upsertSingleVariant(variant, attributeSetId);
        await this.linkVariantToConfigurable(parentSku, variant.sku);
        await this.pushLocalizedVariantFields(variant);
      } catch (error) {
        this.logger.error(
          `Failed to upsert variant ${variant.sku} for product ${parentSku}:`,
          error,
        );
      }
    }
  }

  private async upsertSingleVariant(
    variant: ProductVariant,
    attributeSetId: number,
  ): Promise<void> {
    const existing = await this.getProductBySku(variant.sku);
    const payload = this.mapper.mapToVariantPayload(variant, attributeSetId);

    if (existing) {
      const encodedSku = encodeURIComponent(variant.sku);
      await this.client.put<MagentoProduct>(`/V1/products/${encodedSku}`, payload);
      this.logger.debug(`Updated variant: ${variant.sku}`);
    } else {
      await this.client.post<MagentoProduct>("/V1/products", payload);
      this.logger.debug(`Created variant: ${variant.sku}`);
    }
  }

  /**
   * Assigns a simple product (variant) as a child of a configurable product.
   * Silently ignores if already linked.
   */
  private async linkVariantToConfigurable(
    parentSku: string,
    childSku: string,
  ): Promise<void> {
    const encodedParent = encodeURIComponent(parentSku);
    try {
      await this.client.post(`/V1/configurable-products/${encodedParent}/child`, {
        childSku,
      });
      this.logger.debug(`Linked variant ${childSku} → configurable ${parentSku}`);
    } catch (error: any) {
      if (!error.message?.includes("already")) {
        this.logger.warn(`Could not link ${childSku} to ${parentSku}:`, error);
      }
    }
  }

  /**
   * Pushes localized variant names to each non-default store view.
   */
  private async pushLocalizedVariantFields(variant: ProductVariant): Promise<void> {
    const localeMap = this.config.localeMap;
    if (!localeMap) return;

    const defaultStoreCode = this.config.storeCode ?? "default";
    const encodedSku = encodeURIComponent(variant.sku);

    for (const [locale, storeCode] of Object.entries(localeMap)) {
      if (storeCode === defaultStoreCode) continue;

      const payload = this.mapper.mapToLocalizedVariantPayload(variant, locale);
      try {
        await this.client.put<MagentoProduct>(`/V1/products/${encodedSku}`, payload, storeCode);
      } catch (error) {
        this.logger.warn(
          `Failed localized variant update for ${variant.sku} / store "${storeCode}":`,
          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Configurable options
  // ---------------------------------------------------------------------------

  /**
   * Creates the super_attributes (configurable options) on the parent product.
   * Uses the `configurableAttributes` list from config as the axes.
   */
  private async linkConfigurableOptions(product: Product): Promise<void> {
    const configurableAttrs = this.config.configurableAttributes;
    if (!configurableAttrs || configurableAttrs.length === 0) return;

    const parentSku = encodeURIComponent(product.sku || product.id);

    // Resolve attribute IDs for all configurable axes
    const attrCodeToId = await this.attributeService.resolveConfigurableAttributeIds(
      configurableAttrs,
    );

    // Fetch existing options to avoid duplicates
    let existingOptions: any[] = [];
    try {
      existingOptions = await this.client.get<any[]>(
        `/V1/configurable-products/${parentSku}/options/all`,
      );
    } catch {
      existingOptions = [];
    }

    const existingAttrIds = new Set(
      (existingOptions || []).map((o: any) => String(o.attribute_id)),
    );

    const options = this.mapper.mapToConfigurableOptions(
      product.sku || product.id,
      configurableAttrs,
      attrCodeToId,
    );

    for (const option of options) {
      const opt = option as any;
      if (existingAttrIds.has(String(opt.attribute_id))) {
        this.logger.debug(`Configurable option for attr ${opt.attribute_id} already exists.`);
        continue;
      }

      try {
        await this.client.post(
          `/V1/configurable-products/${parentSku}/options`,
          option,
        );
        this.logger.debug(
          `Created configurable option attr_id=${opt.attribute_id} on ${product.sku}`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to add configurable option attr_id=${opt.attribute_id}:`,
          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Attribute set resolution
  // ---------------------------------------------------------------------------

  /**
   * Determines the Magento attribute set name for a product.
   * Checks familyAttributeSetMap by product family (stored in attributes),
   * falls back to defaultAttributeSetName.
   */
  private resolveAttributeSetName(product: Product): string {
    // The Akeneo family is carried through as a custom attribute "family" or similar
    const familyAttr = product.attributes?.["family"];
    const familyCode =
      (familyAttr && familyAttr[0]?.value) ||
      (product as any).family ||
      null;

    if (familyCode && this.config.familyAttributeSetMap?.[familyCode]) {
      return this.config.familyAttributeSetMap[familyCode];
    }

    return this.config.defaultAttributeSetName ?? "Default";
  }
}
