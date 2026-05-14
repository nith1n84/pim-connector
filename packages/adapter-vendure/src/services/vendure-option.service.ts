import { Logger } from "@pim-connector/core";
import { VendureClient } from "../client/vendure.client.js";
import {
  ADD_OPTION_GROUP_TO_PRODUCT,
  CREATE_PRODUCT_OPTION,
  CREATE_PRODUCT_OPTION_GROUP,
  GET_PRODUCT_OPTION_GROUPS,
  VendureConfig,
} from "../types/vendure.types.js";

/**
 * Service for managing Vendure product options and option groups.
 * Handles creation, lookup, and mapping of Akeneo attributes to Vendure options.
 */
export class VendureOptionService {
  private static globalOptionIdMap: Map<string, string> = new Map();
  private static globalOptionGroupMap: Map<string, string> = new Map();

  constructor(
    private readonly client: VendureClient,
    private readonly config: VendureConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Ensures that the specified option groups and their options exist in Vendure.
   * Returns mappings from Akeneo codes to Vendure IDs.
   */
  async ensureOptionGroupsExist(optionGroups: any[]): Promise<{
    optionGroupMap: Map<string, string>;
    optionIdMap: Map<string, string>;
  }> {
    const optionGroupMap = new Map<string, string>();

    for (const optionGroup of optionGroups) {
      let groupId: string | undefined = VendureOptionService.globalOptionGroupMap.get(
        optionGroup.code,
      );

      if (!groupId) {
        const existingGroupId = await this.findOptionGroupByCode(optionGroup.code);

        if (existingGroupId) {
          groupId = existingGroupId;
          VendureOptionService.globalOptionGroupMap.set(optionGroup.code, groupId);
          await this.populateOptionIdMapFromExistingGroup(groupId, optionGroup);
        } else {
          const createdGroupId = await this.createOptionGroup(optionGroup);
          if (createdGroupId) {
            groupId = createdGroupId;
            VendureOptionService.globalOptionGroupMap.set(optionGroup.code, groupId);

            if (optionGroup.values && optionGroup.values.length > 0) {
              await this.createOptionsForGroup(groupId, optionGroup.values);
            }
          }
        }
      } else {
        await this.populateOptionIdMapFromExistingGroup(groupId, optionGroup);
      }

      if (groupId) {
        optionGroupMap.set(optionGroup.code, groupId);
      }
    }

    return {
      optionGroupMap,
      optionIdMap: VendureOptionService.globalOptionIdMap,
    };
  }

  /**
   * Adds specified option groups to a product.
   */
  async addOptionGroupsToProduct(productId: string, optionGroupIds: string[]): Promise<void> {
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
      const resp = await this.client.request<{
        product: { optionGroups: Array<{ id: string }> };
      }>(query, { id: productId });
      const existingGroupIds = new Set(resp.product?.optionGroups?.map((og) => og.id) || []);

      for (const optionGroupId of optionGroupIds) {
        if (!existingGroupIds.has(optionGroupId)) {
          await this.client.request(ADD_OPTION_GROUP_TO_PRODUCT, {
            productId,
            optionGroupId,
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to manage option groups for product ${productId}:`, error);
    }
  }

  private async findOptionGroupByCode(code: string): Promise<string | null> {
    try {
      const resp = await this.client.request<{
        productOptionGroups: { items: Array<{ id: string; code: string }> };
      }>(GET_PRODUCT_OPTION_GROUPS, {
        options: { filter: { code: { eq: code } } },
      });

      return resp.productOptionGroups.items[0]?.id || null;
    } catch (error) {
      this.logger.error(`Error finding option group ${code}:`, error);
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

      const resp = await this.client.request<{ createProductOptionGroup: { id: string } }>(
        CREATE_PRODUCT_OPTION_GROUP,
        { input: { code: optionGroup.code, translations } },
      );
      return resp.createProductOptionGroup.id;
    } catch (error) {
      this.logger.error(`Failed to create option group ${optionGroup.code}:`, error);
      return null;
    }
  }

  private async createOptionsForGroup(groupId: string, options: any[]): Promise<void> {
    for (const option of options) {
      try {
        const translations = Object.entries(option.name || { en_US: option.code }).map(
          ([languageCode, name]) => ({
            languageCode: this.config.localeMap?.[languageCode] || languageCode,
            name,
          }),
        );

        const resp = await this.client.request<{
          createProductOption: { id: string; code: string };
        }>(CREATE_PRODUCT_OPTION, {
          input: {
            code: option.code,
            translations,
            productOptionGroupId: groupId,
          },
        });

        VendureOptionService.globalOptionIdMap.set(option.code, resp.createProductOption.id);
      } catch (error) {
        this.logger.error(`Failed to create option ${option.code} for group ${groupId}:`, error);
      }
    }
  }

  private async populateOptionIdMapFromExistingGroup(
    groupId: string,
    optionGroup: any,
  ): Promise<void> {
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

    try {
      const resp = await this.client.request<{
        productOptionGroup: { options: Array<{ id: string; code: string; name: any }> };
      }>(query, { groupId });

      if (resp.productOptionGroup?.options) {
        for (const option of optionGroup.values || []) {
          const matched = resp.productOptionGroup.options.find((vo) => {
            const akeneoName = Object.values(option.name || {})[0] as string;
            const vendureName = Object.values(vo.name || {})[0] as string;
            return akeneoName === vendureName || option.code === vo.code;
          });

          if (matched) {
            VendureOptionService.globalOptionIdMap.set(option.code, matched.id);
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Failed to query options for group ${groupId}:`, error);
    }
  }

  /**
   * Static getter for the global option ID map.
   */
  static getGlobalOptionIdMap(): Map<string, string> {
    return VendureOptionService.globalOptionIdMap;
  }
}
