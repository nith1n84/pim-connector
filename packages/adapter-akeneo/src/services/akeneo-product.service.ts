import { Logger, OptionGroup, Page, Product } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";
import { AkeneoMapper } from "../mappers/akeneo.mapper.js";
import { AkeneoProduct, AkeneoProductModel } from "../types/akeneo.types.js";
import { AkeneoAssetService } from "./akeneo-asset.service.js";

/**
 * Service for handling Akeneo product data operations.
 * Orchestrates fetching, variant resolution, and mapping to CDM.
 */
export class AkeneoProductService {
  private familyMappings: Map<string, { labelAttribute: string; imageAttribute: string | null }> =
    new Map();
  private akeneoAssetService: AkeneoAssetService;

  constructor(
    private client: AkeneoClient,
    private mapper: AkeneoMapper,
    private logger: Logger,
  ) {
    this.akeneoAssetService = new AkeneoAssetService(client, logger);
  }

  async getPaginatedProducts(
    page: number,
    limit: number,
    updatedDate?: Date,
  ): Promise<Page<AkeneoProduct>> {
    return this.client.getProducts(page, limit, updatedDate);
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

      const familyMapping = akeneoProduct.family
        ? this.familyMappings.get(akeneoProduct.family)
        : undefined;

      return this.mapper.mapToProduct(akeneoProduct, [], familyMapping);
    } catch (error) {
      return null;
    }
  }

  async fetchProducts(page: number, limit: number, updatedDate?: Date): Promise<Product[]> {
    const akeneoProducts = (await this.getPaginatedProducts(page, limit, updatedDate)).data;

    if (akeneoProducts.length === 0) {
      return [];
    }

    const familyToProducts = new Map<string, AkeneoProduct[]>();

    for (const product of akeneoProducts) {
      const family = product.family;
      if (!family) {
        continue;
      }
      if (!familyToProducts.has(family)) {
        familyToProducts.set(family, []);
      }
      familyToProducts.get(family)!.push(product);
    }

    const familyCodes: string[] = [...familyToProducts.keys()];
    const missingFamilyCodes = familyCodes.filter((code) => !this.familyMappings.has(code));

    if (missingFamilyCodes.length > 0) {
      const families = await this.client.getFamilies(missingFamilyCodes);
      for (const family of families) {
        this.familyMappings.set(family.code, {
          labelAttribute: family.attribute_as_label || "name",
          imageAttribute: family.attribute_as_image || null,
        });
      }
    }

    const allProducts: Product[] = [];

    for (const [familyCode, products] of familyToProducts) {
      const familyMapping = this.familyMappings.get(familyCode);

      if (!familyMapping) {
        continue;
      }

      const variantProductsByParentId = new Map<string, AkeneoProduct[]>();

      for (const akeneoProduct of products) {
        if (akeneoProduct.parent) {
          const parentId = akeneoProduct.parent;
          if (!variantProductsByParentId.has(parentId)) {
            variantProductsByParentId.set(parentId, []);
          }
          variantProductsByParentId.get(parentId)!.push(akeneoProduct);
          continue;
        }

        const mediaFiles: any[] = [];
        if (familyMapping.imageAttribute) {
          const mediaArray = akeneoProduct.values[familyMapping.imageAttribute];
          if (mediaArray && Array.isArray(mediaArray)) {
            for (const media of mediaArray) {
              if (media && media.attribute_type === "pim_catalog_image") {
                const file = await this.akeneoAssetService.downloadProductMediaFile(media.data);
                if (file) {
                  mediaFiles.push(file);
                }
              } else if (
                media &&
                media.attribute_type === "pim_catalog_asset_collection" &&
                Array.isArray(media.data) &&
                media.reference_data_name
              ) {
                const data: string[] = media.data;
                const refDataName = media.reference_data_name;
                const assets = await this.akeneoAssetService.downloadAssetMediaFile(
                  refDataName,
                  data,
                );

                mediaFiles.push(...assets);
              }
            }
          }
        }

        allProducts.push(this.mapper.mapToProduct(akeneoProduct, mediaFiles, familyMapping));
      }

      if (variantProductsByParentId.size > 0) {
        const variantProductsByRootModelCode = new Map<string, AkeneoProduct[]>();

        for (const [parentId, variants] of variantProductsByParentId) {
          let productModel = await this.client.getProductModel(parentId);
          if (!productModel) continue;

          productModel = await this.getRootProductModel(productModel);
          if (!productModel) continue;

          if (!variantProductsByRootModelCode.has(productModel.code)) {
            variantProductsByRootModelCode.set(productModel.code, []);
          }
          variantProductsByRootModelCode.get(productModel.code)!.push(...variants);
        }

        for (const [rootModelCode, variants] of variantProductsByRootModelCode) {
          const productModel = await this.client.getProductModel(rootModelCode);
          if (!productModel) continue;

          const familyVariant = await this.client.getFamilyVariant(
            productModel.family,
            productModel.family_variant,
          );
          if (!familyVariant) continue;
          const allAxes = new Set<string>();
          for (const variantSet of familyVariant.variant_attribute_sets) {
            for (const axis of variantSet.axes) {
              allAxes.add(axis);
            }
          }

          const optionGroups = await this.resolveOptionGroups(Array.from(allAxes));

          const product = this.mapper.mapVariantsToProduct(
            productModel,
            familyVariant,
            variants,
            familyMapping,
            optionGroups,
          );

          if (product) {
            allProducts.push(product);
          }
        }
      }
    }

    return allProducts;
  }

  private async resolveOptionGroups(axes: string[]): Promise<OptionGroup[]> {
    const existingOptionGroups = this.mapper.getOptionGroups();

    const existingMap = new Map(
      existingOptionGroups.map((group: OptionGroup) => [group.code, group]),
    );

    const existing = axes
      .map((axis) => existingMap.get(axis))
      .flatMap((group) => (group ? [group] : []));

    const missingAxes = axes.filter((axis) => !existingMap.has(axis));

    // Fetch only missing ones
    const fetchedOptionGroups = missingAxes.length
      ? await this.client.getOptionGroups(missingAxes)
      : [];
    this.mapper.setOptionGroups([...existingOptionGroups, ...fetchedOptionGroups]);

    // Combine existing + fetched
    return [...existing, ...fetchedOptionGroups];
  }

  /**
   * Recursively finds the root product model for a given model.
   */
  private async getRootProductModel(
    productModel: AkeneoProductModel,
    visited = new Set<string>(),
  ): Promise<AkeneoProductModel | null> {
    if (!productModel) return null;

    if (visited.has(productModel.code)) return productModel;
    visited.add(productModel.code);

    if (productModel.parent) {
      const parentModel = await this.client.getProductModel(productModel.parent);
      if (!parentModel) return productModel;
      return this.getRootProductModel(parentModel, visited);
    }

    return productModel;
  }
}
