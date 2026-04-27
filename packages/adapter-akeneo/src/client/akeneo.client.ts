import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import {
  AkeneoAttribute,
  AkeneoAttributeOption,
  AkeneoConfig,
  AkeneoFamily,
  AkeneoFamilyVariant,
  AkeneoOptionGroup,
  AkeneoPagingResponse,
  AkeneoProductModel,
  AkeneoTokenResponse,
} from "../types/akeneo.types.js";

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

  constructor(private config: AkeneoConfig) {
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
      console.error(
        "Failed to refresh Akeneo access token:",
        error.response?.data || error.message,
      );
      return null;
    }
  }

  /**
   * Generic request helper
   * @param config - Axios request configuration
   * @returns The parsed response data
   */
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.axiosInstance.request<T>(config);
    return response.data;
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
      // After first page, Akeneo's next link includes full path, so we don't need base URL or params again
      currentParams = undefined;
    }
  }

  /**
   * Fetch all attribute definitions
   * @returns Array of attributes
   */
  async getAttributeDefinitions(): Promise<AkeneoAttribute[]> {
    const definitions: AkeneoAttribute[] = [];
    const iterator = this.paginate<AkeneoAttribute>("/api/rest/v1/attributes");
    for await (const items of iterator) {
      definitions.push(...items);
    }
    return definitions;
  }

  /**
   * Fetch all families with their label and image attributes
   * @returns Array of families
   */
  async getFamilies(): Promise<AkeneoFamily[]> {
    const families: AkeneoFamily[] = [];
    const iterator = this.paginate<AkeneoFamily>("/api/rest/v1/families");
    for await (const items of iterator) {
      families.push(...items);
    }
    return families;
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
  async getOptionGroups(): Promise<AkeneoOptionGroup[]> {
    const optionGroups: AkeneoOptionGroup[] = [];

    try {
      console.log("Fetching option groups from Akeneo...");
      const searchFilter = {
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
      console.error("Failed to fetch option groups:", error);
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
      console.warn(`Failed to fetch options for attribute ${attributeCode}:`, error);
      return [];
    }
  }

  /**
   * Clears internal caches.
   */
  clearCaches(): void {
    this.productModelCache.clear();
    this.familyVariantCache.clear();
  }
}
