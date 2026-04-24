import { GraphQLClient } from "graphql-request";
import { Asset, Product, TargetAdapter } from "@pim-connector/core";
import {
  ADD_OPTION_GROUP_TO_PRODUCT,
  CREATE_PRODUCT,
  CREATE_PRODUCT_OPTION,
  CREATE_PRODUCT_OPTION_GROUP,
  CREATE_PRODUCT_VARIANTS,
  GET_PRODUCT_BY_VARIANT_SKU,
  GET_PRODUCT_OPTION_GROUPS,
  LOGIN,
  UPDATE_PRODUCT,
  UPDATE_PRODUCT_VARIANTS,
  UPSERT_PRODUCT_ATTRIBUTES,
  VendureConfig,
} from "./vendure.types.js";
import { VendureMapper } from "./vendure.mapper.js";

export class VendureAdapter implements TargetAdapter {
  readonly name = "vendure";
  private client: GraphQLClient;
  private mapper: VendureMapper;
  private static globalOptionIdMap: Map<string, string> = new Map(); // Shared across all products
  private static globalOptionGroupMap: Map<string, string> = new Map(); // Shared across all products

  constructor(private config: VendureConfig) {
    this.client = new GraphQLClient(config.url);
    if (config.token) {
      this.setAuthToken(config.token);
    }
    this.mapper = new VendureMapper(config);
  }

  private setAuthToken(token: string) {
    this.client.setHeader("Authorization", `Bearer ${token}`);
    this.client.setHeader("vendure-auth-token", token);
  }

  async initialize(): Promise<void> {
    if (this.config.email && this.config.password) {
      console.log("Authenticating with Vendure...");
      try {
        const resp = await this.client.rawRequest<any>(LOGIN, {
          username: this.config.email,
          password: this.config.password,
        });

        const token = resp.headers.get("vendure-auth-token");
        if (token) {
          this.setAuthToken(token);
          console.log("Authenticated successfully via login.");
        } else {
          console.warn("Login successful but no token received in headers.");
        }
      } catch (error) {
        console.error("Vendure authentication failed:", error);
      }
    }
    console.log("Vendure Adapter initialized");
  }

  private async requestWithRetry<T>(query: string, variables: any): Promise<T> {
    const maxRetries = this.config.retries ?? 3;
    const initialDelay = this.config.retryDelayMs ?? 1000;

    const attempt = async (remRetries: number, currentDelay: number): Promise<T> => {
      try {
        return await this.client.request<T>(query, variables);
      } catch (error: any) {
        if (remRetries > 0 && error.message?.includes("database is locked")) {
          console.warn(
            `Database locked, retrying in ${currentDelay}ms... (${remRetries} attempts left)`,
          );
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
          return attempt(remRetries - 1, currentDelay * 2);
        }
        throw error;
      }
    };

    return attempt(maxRetries, initialDelay);
  }

  async upsertProduct(product: Product, targetId?: string): Promise<string> {
    if (!product.sku) return "";
    const existingProduct = targetId ? { id: targetId } : await this.findProductBySku(product.sku);

    let productId: string;
    if (existingProduct) {
      console.log(`Updating existing product ${product.sku} (ID: ${existingProduct.id})`);
      const updateInput = this.mapper.mapToUpdateProductInput(existingProduct.id, product);
      await this.requestWithRetry(UPDATE_PRODUCT, { input: updateInput });
      productId = existingProduct.id;
    } else {
      console.log(`Creating new product ${product.sku}`);
      const createInput = this.mapper.mapToCreateProductInput(product);

      const resp = await this.requestWithRetry<{ createProduct: { id: string } }>(CREATE_PRODUCT, {
        input: createInput,
      });
      productId = resp.createProduct.id;
    }

    // Handle Option Groups first (required for variants)
    console.log(`Product ${product.sku} has optionGroups:`, product.optionGroups?.length || 0);
    if (product.optionGroups && product.optionGroups.length > 0) {
      console.log(`Creating option groups for product ${product.sku}`);
      const { optionGroupMap, optionIdMap } = await this.ensureOptionGroupsExist(
        product.optionGroups,
      );
      await this.addOptionGroupsToProduct(productId, Array.from(optionGroupMap.values()));
    }

    // Handle Variants
    if (product.variants && product.variants.length > 0) {
      await this.upsertVariants(
        productId,
        product.variants,
        (existingProduct as any)?.variants,
        VendureAdapter.globalOptionIdMap,
      );
    }

    // Handle Custom Attributes
    if (product.attributes && Object.keys(product.attributes).length > 0) {
      console.log(`Syncing custom attributes for product ${product.sku}`);
      const attributeInputs = this.mapper.mapToProductAttributeInputs(
        productId,
        product.attributes,
        {
          includeAttributes: this.config.includeAttributes,
          excludeAttributes: this.config.excludeAttributes,
        },
      );

      if (attributeInputs.length > 0) {
        await this.requestWithRetry(UPSERT_PRODUCT_ATTRIBUTES, {
          productId,
          input: attributeInputs,
        });
      }
    }

    return productId;
  }

  private async findProductBySku(sku: string): Promise<any | null> {
    try {
      const resp = await this.client.request<{
        productVariants: { items: any[] };
      }>(GET_PRODUCT_BY_VARIANT_SKU, { sku });
      return resp.productVariants.items[0]?.product || null;
    } catch (error) {
      console.error(`Error finding product by SKU ${sku}:`, error);
      return null;
    }
  }

  private async upsertVariants(
    productId: string,
    variants: any[],
    existingVariants: any[] = [],
    optionIdMap: Map<string, string> = new Map(),
  ): Promise<void> {
    const toCreate = [];
    const toUpdate = [];

    for (const variant of variants) {
      const existing = existingVariants.find((v) => v.sku === variant.sku);
      if (existing) {
        toUpdate.push(this.mapper.mapToUpdateVariantInput(existing.id, variant, optionIdMap));
      } else {
        toCreate.push(this.mapper.mapToCreateVariantInput(productId, variant, optionIdMap));
      }
    }

    if (toCreate.length > 0) {
      await this.requestWithRetry(CREATE_PRODUCT_VARIANTS, { input: toCreate });
    }
    if (toUpdate.length > 0) {
      await this.requestWithRetry(UPDATE_PRODUCT_VARIANTS, { input: toUpdate });
    }
  }

  async upsertAsset(asset: Asset): Promise<void> {
    console.log(`Upserting asset ${asset.url} to Vendure... (Not fully implemented)`);
    // TODO: Implement asset upload via Admin API
  }

  private async findOptionGroupByCode(code: string): Promise<string | null> {
    try {
      const resp = await this.requestWithRetry<{
        productOptionGroups: { items: Array<{ id: string; code: string }> };
      }>(GET_PRODUCT_OPTION_GROUPS, {
        options: {
          filter: {
            code: { eq: code },
          },
        },
      });

      if (resp.productOptionGroups.items.length > 0) {
        return resp.productOptionGroups.items[0].id;
      }
      return null;
    } catch (error) {
      console.error(`Error finding option group by code ${code}:`, error);
      return null;
    }
  }

  private async createOptionGroup(optionGroup: any): Promise<string | null> {
    try {
      const translations = Object.entries(optionGroup.name || { en_US: optionGroup.code }).map(
        ([languageCode, name]) => ({
          languageCode: this.config.localeMap?.[languageCode] || languageCode,
          name,
        }),
      );

      const input = {
        code: optionGroup.code,
        translations,
      };

      const resp = await this.requestWithRetry<{ createProductOptionGroup: { id: string } }>(
        CREATE_PRODUCT_OPTION_GROUP,
        { input },
      );
      return resp.createProductOptionGroup.id;
    } catch (error) {
      console.error(`Failed to create option group ${optionGroup.code}:`, error);
      return null;
    }
  }

  private async createOptionsForGroup(
    groupId: string,
    options: any[],
    optionIdMap: Map<string, string>,
  ): Promise<void> {
    for (const option of options) {
      try {
        const translations = Object.entries(option.name || { en_US: option.code }).map(
          ([languageCode, name]) => ({
            languageCode: this.config.localeMap?.[languageCode] || languageCode,
            name,
          }),
        );

        const input = {
          code: option.code,
          translations,
          productOptionGroupId: groupId,
        };

        const resp = await this.requestWithRetry<{
          createProductOption: { id: string; code: string };
        }>(CREATE_PRODUCT_OPTION, { input });
        console.log(
          `Created option ${option.code} for group ${groupId} (ID: ${resp.createProductOption.id}, Vendure code: ${resp.createProductOption.code})`,
        );

        // Map Akeneo option code to Vendure option ID
        optionIdMap.set(option.code, resp.createProductOption.id);
      } catch (error) {
        console.error(`Failed to create option ${option.code} for group ${groupId}:`, error);
      }
    }
  }

  private async ensureOptionGroupsExist(
    optionGroups: any[],
  ): Promise<{ optionGroupMap: Map<string, string>; optionIdMap: Map<string, string> }> {
    const optionGroupMap = new Map<string, string>();

    for (const optionGroup of optionGroups) {
      // Check if option group already exists in the global map
      let groupId: string | undefined = VendureAdapter.globalOptionGroupMap.get(optionGroup.code);

      if (!groupId) {
        // Check if option group exists in Vendure
        const existingGroupId = await this.findOptionGroupByCode(optionGroup.code);

        if (existingGroupId) {
          groupId = existingGroupId;
          // Found existing option group in Vendure, add to global map
          VendureAdapter.globalOptionGroupMap.set(optionGroup.code, groupId);
          console.log(
            `Found existing option group in Vendure: ${optionGroup.code} (ID: ${groupId})`,
          );
          // Query existing options for this group to populate the optionIdMap
          await this.populateOptionIdMapFromExistingGroup(groupId, optionGroup);
        } else {
          // Create new option group if it doesn't exist in Vendure
          const createdGroupId = await this.createOptionGroup(optionGroup);
          if (createdGroupId) {
            groupId = createdGroupId;
            VendureAdapter.globalOptionGroupMap.set(optionGroup.code, groupId);
            console.log(`Created option group: ${optionGroup.code} (ID: ${groupId})`);

            // Create options for this group and track the mapping
            if (optionGroup.values && optionGroup.values.length > 0) {
              await this.createOptionsForGroup(
                groupId,
                optionGroup.values,
                VendureAdapter.globalOptionIdMap,
              );
            }
          }
        }
      } else {
        console.log(
          `Using existing option group from global map: ${optionGroup.code} (ID: ${groupId})`,
        );
        // Query existing options for this group to populate the optionIdMap
        await this.populateOptionIdMapFromExistingGroup(groupId, optionGroup);
      }

      if (groupId) {
        optionGroupMap.set(optionGroup.code, groupId);
      }
    }

    return { optionGroupMap, optionIdMap: VendureAdapter.globalOptionIdMap };
  }

  private async addOptionGroupsToProduct(
    productId: string,
    optionGroupIds: string[],
  ): Promise<void> {
    // First, get existing option groups for the product
    const query = `
      query GetProduct($id: ID!) {
        product(id: $id) {
          optionGroups {
            id
          }
        }
      }
    `;

    try {
      const resp = await this.requestWithRetry<{
        product: { optionGroups: Array<{ id: string }> };
      }>(query, { id: productId });
      const existingGroupIds = new Set(resp.product?.optionGroups?.map((og) => og.id) || []);

      for (const optionGroupId of optionGroupIds) {
        if (existingGroupIds.has(optionGroupId)) {
          console.log(
            `Option group ${optionGroupId} already assigned to product ${productId}, skipping`,
          );
          continue;
        }

        try {
          await this.requestWithRetry(ADD_OPTION_GROUP_TO_PRODUCT, {
            productId,
            optionGroupId,
          });
          console.log(`Added option group ${optionGroupId} to product ${productId}`);
        } catch (error) {
          console.error(
            `Failed to add option group ${optionGroupId} to product ${productId}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error(`Failed to query product ${productId} for existing option groups:`, error);
      // If query fails, try adding all groups anyway
      for (const optionGroupId of optionGroupIds) {
        try {
          await this.requestWithRetry(ADD_OPTION_GROUP_TO_PRODUCT, {
            productId,
            optionGroupId,
          });
          console.log(`Added option group ${optionGroupId} to product ${productId}`);
        } catch (error) {
          console.error(
            `Failed to add option group ${optionGroupId} to product ${productId}:`,
            error,
          );
        }
      }
    }
  }

  private async populateOptionIdMapFromExistingGroup(
    groupId: string,
    optionGroup: any,
  ): Promise<void> {
    try {
      const query = `
        query GetProductOptions($groupId: ID!) {
          productOptionGroup(id: $groupId) {
            options {
              id
              code
              name
            }
          }
        }
      `;

      const resp = await this.requestWithRetry<{
        productOptionGroup: { options: Array<{ id: string; code: string; name: any }> };
      }>(query, { groupId });

      if (resp.productOptionGroup?.options) {
        for (const akeneoOption of optionGroup.values || []) {
          // Find matching Vendure option by comparing names
          const vendureOption: { id: string; code: string; name: any } | undefined =
            resp.productOptionGroup.options.find((vo: { id: string; code: string; name: any }) => {
              const akeneoName = Object.values(akeneoOption.name || {})[0] as string;
              const vendureName = Object.values(vo.name || {})[0] as string;
              return akeneoName === vendureName || akeneoOption.code === vo.code;
            });

          if (vendureOption) {
            // Map Akeneo option code to Vendure option ID
            VendureAdapter.globalOptionIdMap.set(akeneoOption.code, vendureOption.id);
            console.log(
              `Mapped Akeneo option ${akeneoOption.code} to Vendure ID ${vendureOption.id} (Vendure code: ${vendureOption.code})`,
            );
          }
        }
      }
    } catch (error) {
      console.error(`Failed to query options for group ${groupId}:`, error);
    }
  }
}
