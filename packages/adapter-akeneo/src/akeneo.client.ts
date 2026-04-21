import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { AkeneoConfig, AkeneoPagingResponse, AkeneoTokenResponse } from "./akeneo.types.js";

export class AkeneoClient {
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

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
   */
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.axiosInstance.request<T>(config);
    return response.data;
  }

  /**
   * Fetch a single page of items
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
   */
  async getAttributeDefinitions(): Promise<any[]> {
    const definitions: any[] = [];
    const iterator = this.paginate<any>("/api/rest/v1/attributes");
    for await (const items of iterator) {
      definitions.push(...items);
    }
    return definitions;
  }

  /**
   * Fetch all families with their label and image attributes
   */
  async getFamilies(): Promise<any[]> {
    const families: any[] = [];
    const iterator = this.paginate<any>("/api/rest/v1/families");
    for await (const items of iterator) {
      families.push(...items);
    }
    return families;
  }
}
