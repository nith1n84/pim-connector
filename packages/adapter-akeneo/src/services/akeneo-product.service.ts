import { Logger, OptionGroup, Page, Product } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";
import { AkeneoMapper } from "../mappers/akeneo.mapper.js";
import { AkeneoProduct, AkeneoProductModel } from "../types/akeneo.types.js";
import { AkeneoAssetService } from "./akeneo-asset.service.js";
import { AkeneoOptionService } from "./akeneo-option.service.js";
import { AkeneoVariantService } from "./akeneo-variant.service.js";

/**
 * Service for handling Akeneo product data operations.
 * Orchestrates fetching, variant resolution, and mapping to CDM.
 */
export class AkeneoProductService {
  private familyMappings: Map<string, { labelAttribute: string; imageAttribute: string | null }> =
    new Map();
  private assetService: AkeneoAssetService;
  private optionService: AkeneoOptionService;
  private variantService: AkeneoVariantService;

  constructor(
    private readonly client: AkeneoClient,
    private readonly mapper: AkeneoMapper,
    private readonly logger: Logger,
  ) {
    this.assetService = new AkeneoAssetService(client, logger);
    this.optionService = new AkeneoOptionService(client, mapper, logger);
    this.variantService = new AkeneoVariantService(client, logger);
  }

  /**
   * Fetches products from Akeneo and maps them to CDM format.
   * Handles both simple products and complex variant structures.
   */
  async fetchProducts(page: number, limit: number, updatedDate?: Date): Promise<Product[]> {
    const akeneoProducts = (await this.client.getProducts(page, limit, updatedDate)).data;
    if (akeneoProducts.length === 0) return [];

    // 1. Group products by family for bulk metadata retrieval
    const familyToProducts = this.groupProductsByFamily(akeneoProducts);
    await this.ensureFamilyMappingsExist(Array.from(familyToProducts.keys()));

    const allProducts: Product[] = [];
    const variantProducts: AkeneoProduct[] = [];

    // 2. Process simple products and collect variants
    for (const [familyCode, products] of familyToProducts) {
      const familyMapping = this.familyMappings.get(familyCode)!;

      for (const product of products) {
        if (product.parent) {
          variantProducts.push(product);
          continue;
        }

        const media = await this.fetchProductMedia(product, familyMapping);
        allProducts.push(this.mapper.mapToProduct(product, media, familyMapping));
      }
    }

    // 3. Process variant products
    if (variantProducts.length > 0) {
      const groupedVariants = await this.variantService.groupProductsByRootModel(variantProducts);
      for (const [rootModelCode, variants] of groupedVariants) {
        const product = await this.processVariantGroup(rootModelCode, variants);
        if (product) allProducts.push(product);
      }
    }

    return allProducts;
  }

  /**
   * Fetches a single product by ID.
   */
  async getProduct(id: string): Promise<Product | null> {
    try {
      const akeneoProduct = await this.client.request<AkeneoProduct>({
        url: `/api/rest/v1/products/${id}`,
        method: "GET",
      });

      await this.ensureFamilyMappingsExist([akeneoProduct.family].filter((f): f is string => !!f));
      const familyMapping = akeneoProduct.family
        ? this.familyMappings.get(akeneoProduct.family)
        : undefined;

      return this.mapper.mapToProduct(akeneoProduct, [], familyMapping);
    } catch (error) {
      return null;
    }
  }

  private groupProductsByFamily(products: AkeneoProduct[]): Map<string, AkeneoProduct[]> {
    const groups = new Map<string, AkeneoProduct[]>();
    for (const product of products) {
      if (!product.family) continue;
      const list = groups.get(product.family) || [];
      list.push(product);
      groups.set(product.family, list);
    }
    return groups;
  }

  private async ensureFamilyMappingsExist(familyCodes: string[]): Promise<void> {
    const missing = familyCodes.filter((code) => !this.familyMappings.has(code));
    if (missing.length === 0) return;

    const families = await this.client.getFamilies(missing);
    for (const family of families) {
      this.familyMappings.set(family.code, {
        labelAttribute: family.attribute_as_label || "name",
        imageAttribute: family.attribute_as_image || null,
      });
    }
  }

  private async fetchProductMedia(product: AkeneoProduct, familyMapping: any): Promise<any[]> {
    const mediaFiles: any[] = [];
    if (!familyMapping.imageAttribute) return mediaFiles;

    const mediaArray = product.values[familyMapping.imageAttribute];
    if (!mediaArray || !Array.isArray(mediaArray)) return mediaFiles;

    for (const media of mediaArray) {
      if (media?.attribute_type === "pim_catalog_image") {
        const file = await this.assetService.downloadProductMediaFile(media.data);
        if (file) mediaFiles.push(file);
      } else if (
        media?.attribute_type === "pim_catalog_asset_collection" &&
        Array.isArray(media.data) &&
        media.reference_data_name
      ) {
        const assets = await this.assetService.downloadAssetMediaFile(
          media.reference_data_name,
          media.data,
        );
        mediaFiles.push(...assets);
      }
    }
    return mediaFiles;
  }

  private async processVariantGroup(
    rootModelCode: string,
    variants: AkeneoProduct[],
  ): Promise<Product | null> {
    const productModel = await this.client.getProductModel(rootModelCode);
    if (!productModel) return null;

    const familyVariant = await this.client.getFamilyVariant(
      productModel.family,
      productModel.family_variant,
    );
    if (!familyVariant) return null;

    // Resolve all attribute codes (axes) across all levels of the family variant
    const axes = familyVariant.variant_attribute_sets.flatMap((set) => set.axes);
    const optionGroups = await this.optionService.resolveOptionGroups(axes);

    return this.mapper.mapVariantsToProduct(
      productModel,
      familyVariant,
      variants,
      this.familyMappings.get(productModel.family)!,
      optionGroups,
    );
  }
}
