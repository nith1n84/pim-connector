import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import {
  AkeneoAssetFamily,
  AkeneoAttributeOption,
  AkeneoCategory,
  AkeneoConfig,
  AkeneoFamily,
  AkeneoFamilyVariant,
  AkeneoPagingResponse,
  AkeneoProduct,
  AkeneoProductModel,
  AkeneoTokenResponse,
} from "../types/akeneo.types.js";
import { Logger, OptionGroup, Page } from "@pim-connector/core";
import { formatAkeneoDate } from "../utils/akeneo.utils.js";

/**
 * Client for interacting with the Akeneo REST API.
 * Handles authentication, token refreshing, and pagination.
 */
export class AkeneoClient {
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  // Cache for reducing redundant API calls
  private productModelCache: Map<string, AkeneoProductModel | null> = new Map();
  private familyVariantCache: Map<string, AkeneoFamilyVariant | null> = new Map();
  private assetFamilyCache: Map<string, any> = new Map();

  constructor(
    private config: AkeneoConfig,
    private logger: Logger,
  ) {
    this.axiosInstance = axios.create({
      baseURL: config.url.endsWith("/") ? config.url.slice(0, -1) : config.url,
    });

    // Add interceptor for authentication
    this.axiosInstance.interceptors.request.use(async (requestConfig) => {
      // Skip auth for the token endpoint itself
      if (requestConfig.url?.includes("/api/oauth/v1/token")) {
        return requestConfig;
      }

      const token = await this.getValidToken();
      if (token) {
        requestConfig.headers.Authorization = `Bearer ${token}`;
      }
      return requestConfig;
    });
  }

  /**
   * Get an access token, refreshing if necessary or expired.
   */
  private async getValidToken(): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);

    if (this.accessToken && this.tokenExpiry && now < this.tokenExpiry - 60) {
      return this.accessToken;
    }

    return this.refreshAccessToken();
  }

  /**
   * Refresh the access token using Client Credentials flow.
   */
  private async refreshAccessToken(): Promise<string | null> {
    const authHeader = Buffer.from(`${this.config.clientId}:${this.config.secret}`).toString(
      "base64",
    );

    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("username", this.config.username || "");
    params.append("password", this.config.password || "");
    // Note: Akeneo Cloud often uses username/password with client credentials for technical accounts

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const response = await axios.post<AkeneoTokenResponse>(
          `${this.axiosInstance.defaults.baseURL}/api/oauth/v1/token`,
          params,
          {
            headers: {
              Authorization: `Basic ${authHeader}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          },
        );

        this.accessToken = response.data.access_token;
        this.tokenExpiry = Math.floor(Date.now() / 1000) + response.data.expires_in;
        return this.accessToken;
      } catch (error: any) {
        attempt++;
        const status = error.response?.status;
        const isTransient = status === 429 || (status >= 500 && status <= 599) || !status; // !status usually means network error

        if (attempt < maxRetries && isTransient) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.debug(
            `Failed to refresh Akeneo token, retrying in ${delay}ms... (${
              maxRetries - attempt
            } attempts left)`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        this.logger.error(
          "Failed to refresh Akeneo access token:",
          error.response?.data || error.message,
        );
        return null;
      }
    }
    return null;
  }

  /**
   * Generic request helper with retry logic
   * @param config - Axios request configuration
   * @returns The parsed response data
   */
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const maxRetries = 3;
    const initialDelay = 1000;

    const attempt = async (remRetries: number, currentDelay: number): Promise<T> => {
      try {
        const response = await this.axiosInstance.request<T>(config);
        return response.data;
      } catch (error: any) {
        const status = error.response?.status;
        const code = error.code;
        const transientNetworkCodes = [
          "ECONNRESET",
          "ETIMEDOUT",
          "ECONNREFUSED",
          "EHOSTUNREACH",
          "ENOTFOUND",
        ];

        const isRetryable =
          status === 429 ||
          (status >= 500 && status <= 599) ||
          transientNetworkCodes.includes(code);

        if (remRetries > 0 && isRetryable) {
          const reason = status ? `status ${status}` : `network code ${code}`;
          this.logger.debug(
            `Akeneo API transient error (${reason}), retrying in ${currentDelay}ms... (${remRetries} attempts left)`,
          );
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
          return attempt(remRetries - 1, currentDelay * 2);
        }
        throw error;
      }
    };

    return attempt(maxRetries, initialDelay);
  }

  /**
   * Fetch a single page of items
   * @param url - The endpoint URL
   * @param params - Query parameters
   * @returns A paged response of items
   */
  async getPage<T>(url: string, params?: Record<string, any>): Promise<AkeneoPagingResponse<T>> {
    return this.request<AkeneoPagingResponse<T>>({
      url,
      method: "GET",
      params,
    });
  }

  async fetchPage<T>(
    url: string,
    page: number = 1,
    limit: number = 100,
    params: Record<string, any> = {},
  ): Promise<Page<T>> {
    const queryParams = {
      page: page,
      limit: limit,
      ...params,
    };

    const response: AkeneoPagingResponse<T> = await this.getPage<T>(url, queryParams);

    const items = response._embedded.items;

    const total = response.items_count ?? 0; // depends on Akeneo response
    const totalPages = Math.ceil(total / limit);

    return {
      data: items,
      page,
      limit,
      total,
      totalPages,
    };
  }

  /**
   * Generator for paginated items
   * @param url - The endpoint URL
   * @param params - Query parameters
   * @yields Batches of items until all pages are exhausted
   */
  async *paginate<T>(url: string, params?: Record<string, any>): AsyncGenerator<T[]> {
    let currentUrl: string | undefined = url;
    let currentParams = params;

    while (currentUrl) {
      const response: AkeneoPagingResponse<T> = await this.getPage<T>(currentUrl, currentParams);
      yield response._embedded.items;

      currentUrl = response._links.next?.href;
      // After first page, Akeneo's next link includes full path, so we don't need Base-URL or params again
      currentParams = undefined;
    }
  }

  /**
   * Fetch all families with their label and image attributes
   * @returns Array of families
   */
  async getFamilies(codes?: string[]): Promise<AkeneoFamily[]> {
    const searchFilter = codes
      ? {
          code: [
            {
              operator: "IN" as const,
              value: codes,
            },
          ],
        }
      : {};

    const families: AkeneoFamily[] = [];

    const iterator = this.paginate<AkeneoFamily>("/api/rest/v1/families", {
      search: JSON.stringify(searchFilter),
    });
    for await (const items of iterator) {
      families.push(...items);
    }
    return families;
  }

  async getProducts(page: number, limit: number, updatedDate?: Date) {
    const search = updatedDate
      ? { updated: [{ operator: ">" as const, value: formatAkeneoDate(updatedDate) }] }
      : {};

    return await this.fetchPage<AkeneoProduct>("/api/rest/v1/products", page, limit, {
      with_count: true,
      search: JSON.stringify(search),
    });
  }

  /**
   * Fetches a product model by code. Uses internal cache to avoid redundant calls.
   */
  async getProductModel(code: string): Promise<AkeneoProductModel | null> {
    if (this.productModelCache.has(code)) {
      return this.productModelCache.get(code)!;
    }

    try {
      const model = await this.request<AkeneoProductModel>({
        url: `/api/rest/v1/product-models/${code}`,
        method: "GET",
      });
      this.productModelCache.set(code, model);
      return model;
    } catch (error) {
      this.productModelCache.set(code, null);
      return null;
    }
  }

  /**
   * Fetches a family variant. Uses internal cache to avoid redundant calls.
   */
  async getFamilyVariant(family: string, code: string): Promise<AkeneoFamilyVariant | null> {
    const cacheKey = `${family}:${code}`;
    if (this.familyVariantCache.has(cacheKey)) {
      return this.familyVariantCache.get(cacheKey)!;
    }

    try {
      const variant = await this.request<AkeneoFamilyVariant>({
        url: `/api/rest/v1/families/${family}/variants/${code}`,
        method: "GET",
      });
      this.familyVariantCache.set(cacheKey, variant);
      return variant;
    } catch (error) {
      this.familyVariantCache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Fetches all option groups from Akeneo (simple select and multiselect attributes).
   */
  async getOptionGroups(familyCodes: string[]): Promise<OptionGroup[]> {
    const optionGroups: OptionGroup[] = [];

    try {
      this.logger.debug(`Fetching option groups for [${familyCodes}] from Akeneo...`);
      const searchFilter = familyCodes
        ? {
            code: [
              {
                operator: "IN" as const,
                value: familyCodes,
              },
            ],
          }
        : {
            type: [
              {
                operator: "IN" as const,
                value: ["pim_catalog_simpleselect", "pim_catalog_multiselect"],
              },
            ],
          };

      const iterator = this.paginate<any>("/api/rest/v1/attributes", {
        search: JSON.stringify(searchFilter),
      });

      for await (const attributes of iterator) {
        for (const attribute of attributes) {
          const options = await this.getAttributeOptions(attribute.code);

          if (options && options.length > 0) {
            optionGroups.push({
              id: attribute.code,
              code: attribute.code,
              name: attribute.labels || {},
              values: options.map((option) => ({
                id: option.code,
                code: option.code,
                name: option.labels || {},
                optionGroupId: attribute.code,
              })),
            });
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to fetch option groups:", error);
    }

    return optionGroups;
  }

  /**
   * Fetches all options for a specific attribute.
   */
  async getAttributeOptions(attributeCode: string): Promise<AkeneoAttributeOption[]> {
    try {
      const options: AkeneoAttributeOption[] = [];
      const iterator = this.paginate<AkeneoAttributeOption>(
        `/api/rest/v1/attributes/${attributeCode}/options`,
      );

      for await (const items of iterator) {
        options.push(...items);
      }

      return options;
    } catch (error) {
      this.logger.warn(`Failed to fetch options for attribute ${attributeCode}:`, error);
      return [];
    }
  }

  /**
   * Clears internal caches.
   */
  clearCaches(): void {
    this.productModelCache.clear();
    this.familyVariantCache.clear();
    this.assetFamilyCache.clear();
  }

  /**
   * Fetches all categories from Akeneo.
   */
  async getCategories(): Promise<AkeneoCategory[]> {
    const categories: AkeneoCategory[] = [];
    const iterator = this.paginate<AkeneoCategory>("/api/rest/v1/categories");
    for await (const items of iterator) {
      categories.push(...items);
    }
    return categories;
  }

  async getAssetFamily(assetFamilyCode: string): Promise<AkeneoAssetFamily | null> {
    if (this.assetFamilyCache.has(assetFamilyCode)) {
      return this.assetFamilyCache.get(assetFamilyCode)!;
    }

    try {
      const assetFamily = await this.request<AkeneoAssetFamily>({
        url: `/api/rest/v1/asset-families/${assetFamilyCode}`,
        method: "GET",
      });
      this.assetFamilyCache.set(assetFamilyCode, assetFamily);
      return assetFamily;
    } catch (error) {
      this.assetFamilyCache.set(assetFamilyCode, null);
      return null;
    }
  }

  async getAssetsFromAssetFamily(assetFamilyCode: string, assetCodes: string[]) {
    const searchFilter = assetCodes
      ? {
          code: [
            {
              operator: "IN" as const,
              value: assetCodes,
            },
          ],
        }
      : {};

    const assets: any[] = [];
    const iterator = this.paginate<any>(`/api/rest/v1/asset-families/${assetFamilyCode}/assets`, {
      search: JSON.stringify(searchFilter),
    });
    for await (const items of iterator) {
      assets.push(...items);
    }
    return assets;
  }
}
