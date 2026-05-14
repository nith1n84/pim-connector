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
 * Handles authentication, token refreshing, network resilience, and pagination.
 */
export class AkeneoClient {
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  // Internal caches to minimize redundant network traffic
  private productModelCache: Map<string, AkeneoProductModel | null> = new Map();
  private familyVariantCache: Map<string, AkeneoFamilyVariant | null> = new Map();
  private assetFamilyCache: Map<string, AkeneoAssetFamily | null> = new Map();

  constructor(
    private readonly config: AkeneoConfig,
    private readonly logger: Logger,
  ) {
    this.axiosInstance = axios.create({
      baseURL: config.url.endsWith("/") ? config.url.slice(0, -1) : config.url,
    });

    this.setupInterceptors();
  }

  /**
   * Sets up axios interceptors for automatic authentication.
   */
  private setupInterceptors(): void {
    this.axiosInstance.interceptors.request.use(async (config) => {
      if (config.url?.includes("/api/oauth/v1/token")) {
        return config;
      }

      const token = await this.getValidToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  /**
   * Retrieves a valid access token, performing a refresh if necessary.
   */
  private async getValidToken(): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.tokenExpiry && now < this.tokenExpiry - 60) {
      return this.accessToken;
    }
    return this.refreshAccessToken();
  }

  /**
   * Refreshes the OAuth2 access token using the password grant flow.
   */
  private async refreshAccessToken(): Promise<string | null> {
    const authHeader = Buffer.from(`${this.config.clientId}:${this.config.secret}`).toString(
      "base64",
    );
    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("username", this.config.username || "");
    params.append("password", this.config.password || "");

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
        const isTransient = status === 429 || (status >= 500 && status <= 599) || !status;

        if (attempt < maxRetries && isTransient) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.debug(`Failed to refresh Akeneo token, retrying in ${delay}ms...`);
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
   * Performs an HTTP request with exponential backoff for transient errors.
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
        const isRetryable = this.isRetryableError(error);

        if (remRetries > 0 && isRetryable) {
          const reason = status ? `status ${status}` : `network code ${error.code}`;
          this.logger.debug(
            `Akeneo API transient error (${reason}), retrying in ${currentDelay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
          return attempt(remRetries - 1, currentDelay * 2);
        }
        throw error;
      }
    };

    return attempt(maxRetries, initialDelay);
  }

  private isRetryableError(error: any): boolean {
    const status = error.response?.status;
    const transientNetworkCodes = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENOTFOUND",
    ];
    return (
      status === 429 ||
      (status >= 500 && status <= 599) ||
      transientNetworkCodes.includes(error.code)
    );
  }

  /**
   * Fetches a paginated result set from Akeneo.
   */
  async fetchPage<T>(
    url: string,
    page: number = 1,
    limit: number = 100,
    params: Record<string, any> = {},
  ): Promise<Page<T>> {
    const response = await this.request<AkeneoPagingResponse<T>>({
      url,
      method: "GET",
      params: { page, limit, ...params },
    });

    const total = response.items_count ?? 0;
    return {
      data: response._embedded.items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Asynchronous generator to iterate over all pages of an endpoint.
   */
  async *paginate<T>(url: string, params?: Record<string, any>): AsyncGenerator<T[]> {
    let currentUrl: string | undefined = url;
    let currentParams = params;

    while (currentUrl) {
      const response: AkeneoPagingResponse<T> = await this.request<AkeneoPagingResponse<T>>({
        url: currentUrl,
        method: "GET",
        params: currentParams,
      });
      yield response._embedded.items;
      currentUrl = response._links.next?.href;
      currentParams = undefined;
    }
  }

  /**
   * Retrieves specific families by their codes.
   */
  async getFamilies(codes?: string[]): Promise<AkeneoFamily[]> {
    const filter = codes ? { code: [{ operator: "IN" as const, value: codes }] } : {};
    const families: AkeneoFamily[] = [];
    for await (const items of this.paginate<AkeneoFamily>("/api/rest/v1/families", {
      search: JSON.stringify(filter),
    })) {
      families.push(...items);
    }
    return families;
  }

  /**
   * Fetches products based on pagination and last update date.
   */
  async getProducts(page: number, limit: number, updatedDate?: Date): Promise<Page<AkeneoProduct>> {
    const search = updatedDate
      ? { updated: [{ operator: ">" as const, value: formatAkeneoDate(updatedDate) }] }
      : {};
    return this.fetchPage<AkeneoProduct>("/api/rest/v1/products", page, limit, {
      with_count: true,
      search: JSON.stringify(search),
    });
  }

  /**
   * Fetches a product model by code, utilizing the internal cache.
   */
  async getProductModel(code: string): Promise<AkeneoProductModel | null> {
    if (this.productModelCache.has(code)) return this.productModelCache.get(code)!;

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
   * Fetches a family variant definition.
   */
  async getFamilyVariant(family: string, code: string): Promise<AkeneoFamilyVariant | null> {
    const key = `${family}:${code}`;
    if (this.familyVariantCache.has(key)) return this.familyVariantCache.get(key)!;

    try {
      const variant = await this.request<AkeneoFamilyVariant>({
        url: `/api/rest/v1/families/${family}/variants/${code}`,
        method: "GET",
      });
      this.familyVariantCache.set(key, variant);
      return variant;
    } catch (error) {
      this.familyVariantCache.set(key, null);
      return null;
    }
  }

  /**
   * Resolves attribute options for the specified attributes.
   */
  async getOptionGroups(attributeCodes: string[]): Promise<OptionGroup[]> {
    const optionGroups: OptionGroup[] = [];
    const filter = { code: [{ operator: "IN" as const, value: attributeCodes }] };

    for await (const attributes of this.paginate<any>("/api/rest/v1/attributes", {
      search: JSON.stringify(filter),
    })) {
      for (const attribute of attributes) {
        const options = await this.getAttributeOptions(attribute.code);
        if (options.length > 0) {
          optionGroups.push({
            id: attribute.code,
            code: attribute.code,
            name: attribute.labels || {},
            values: options.map((o) => ({
              id: o.code,
              code: o.code,
              name: o.labels || {},
              optionGroupId: attribute.code,
            })),
          });
        }
      }
    }
    return optionGroups;
  }

  private async getAttributeOptions(attributeCode: string): Promise<AkeneoAttributeOption[]> {
    const options: AkeneoAttributeOption[] = [];
    try {
      for await (const items of this.paginate<AkeneoAttributeOption>(
        `/api/rest/v1/attributes/${attributeCode}/options`,
      )) {
        options.push(...items);
      }
    } catch (error) {
      this.logger.debug(`No options found for attribute ${attributeCode}`);
    }
    return options;
  }

  /**
   * Fetches all categories.
   */
  async getCategories(): Promise<AkeneoCategory[]> {
    const categories: AkeneoCategory[] = [];
    for await (const items of this.paginate<AkeneoCategory>("/api/rest/v1/categories")) {
      categories.push(...items);
    }
    return categories;
  }

  /**
   * Retrieves an asset family definition.
   */
  async getAssetFamily(code: string): Promise<AkeneoAssetFamily | null> {
    if (this.assetFamilyCache.has(code)) return this.assetFamilyCache.get(code)!;
    try {
      const family = await this.request<AkeneoAssetFamily>({
        url: `/api/rest/v1/asset-families/${code}`,
        method: "GET",
      });
      this.assetFamilyCache.set(code, family);
      return family;
    } catch (error) {
      this.assetFamilyCache.set(code, null);
      return null;
    }
  }

  /**
   * Retrieves assets belonging to a specific asset family.
   */
  async getAssetsFromAssetFamily(familyCode: string, codes: string[]): Promise<any[]> {
    const filter = { code: [{ operator: "IN" as const, value: codes }] };
    const assets: any[] = [];
    for await (const items of this.paginate<any>(
      `/api/rest/v1/asset-families/${familyCode}/assets`,
      { search: JSON.stringify(filter) },
    )) {
      assets.push(...items);
    }
    return assets;
  }

  clearCaches(): void {
    this.productModelCache.clear();
    this.familyVariantCache.clear();
    this.assetFamilyCache.clear();
  }
}
