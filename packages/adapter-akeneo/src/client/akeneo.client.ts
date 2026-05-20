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
import { Logger, OptionGroup, Page, TokenStore } from "@pim-connector/core";
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
    private readonly tokenStore?: TokenStore,
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

    // Try to get from shared token store
    if (this.tokenStore) {
      const sharedToken = await this.tokenStore.getToken("akeneo");
      if (sharedToken) {
        this.accessToken = sharedToken;
        // We don't have the exact expiry but we know it's valid if store returned it
        return this.accessToken;
      }
    }

    return this.refreshAccessToken();
  }

  /**
   * Refreshes the OAuth2 access token.
   * Attempts to use a refresh token if available, otherwise falls back to password grant.
   */
  private async refreshAccessToken(): Promise<string | null> {
    const authHeader = Buffer.from(`${this.config.clientId}:${this.config.secret}`).toString(
      "base64",
    );

    // 1. Try Refresh Token Grant if available in store
    if (this.tokenStore) {
      const authToken = await this.tokenStore.getAuthToken("akeneo");
      if (authToken?.refreshToken) {
        this.logger.debug("Attempting to refresh Akeneo access token using refresh token...");
        const refreshed = await this.executeTokenRequest(
          {
            grant_type: "refresh_token",
            refresh_token: authToken.refreshToken,
          },
          authHeader,
        );

        if (refreshed) return refreshed;
        this.logger.debug("Refresh token grant failed or expired. Falling back to password grant.");
      }
    }

    // 2. Fallback to Password Grant
    const params = {
      grant_type: "password",
      username: this.config.username || "",
      password: this.config.password || "",
    };

    return this.executeTokenRequest(params, authHeader);
  }

  /**
   * Executes a token request (either password or refresh_token grant).
   */
  private async executeTokenRequest(
    params: Record<string, string>,
    authHeader: string,
  ): Promise<string | null> {
    const urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      urlParams.append(key, value);
    }

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const response = await axios.post<AkeneoTokenResponse>(
          `${this.axiosInstance.defaults.baseURL}/api/oauth/v1/token`,
          urlParams,
          {
            headers: {
              Authorization: `Basic ${authHeader}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          },
        );

        this.accessToken = response.data.access_token;
        this.tokenExpiry = Math.floor(Date.now() / 1000) + response.data.expires_in;

        // Save to shared token store (including new refresh token)
        if (this.tokenStore) {
          await this.tokenStore.saveToken(
            "akeneo",
            this.accessToken,
            response.data.expires_in,
            response.data.refresh_token,
          );
        }

        return this.accessToken;
      } catch (error: any) {
        attempt++;
        const status = error.response?.status;
        const isTransient = status === 429 || (status >= 500 && status <= 599) || !status;

        if (attempt < maxRetries && isTransient) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.debug(`Token request failed, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // If it's a 400 error during refresh, it likely means the refresh token is invalid
        if (status === 400 && params.grant_type === "refresh_token") {
          return null;
        }

        this.logger.error("Akeneo token request failed:", error.response?.data || error.message);
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
   * Retrieves all attribute codes belonging to a specific family.
   * Calls GET /api/rest/v1/families/:code/attributes
   */
  async getFamilyAttributes(familyCode: string): Promise<string[]> {
    const attributeCodes: string[] = [];
    try {
      for await (const items of this.paginate<{ code: string }>(
        `/api/rest/v1/families/${familyCode}/attributes`,
      )) {
        attributeCodes.push(...items.map((a) => a.code));
      }
    } catch (error) {
      this.logger.debug(`Could not fetch attributes for family ${familyCode}:`, error);
    }
    return attributeCodes;
  }

  /**
   * Fetches full attribute definitions by their codes.
   * Calls GET /api/rest/v1/attributes filtered by code.
   */
  async getAllAttributes(codes?: string[]): Promise<any[]> {
    const filter = codes && codes.length > 0
      ? { code: [{ operator: "IN" as const, value: codes }] }
      : {};
    const attributes: any[] = [];
    for await (const items of this.paginate<any>("/api/rest/v1/attributes", {
      search: JSON.stringify(filter),
    })) {
      attributes.push(...items);
    }
    return attributes;
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
