import { Logger, TokenStore } from "@pim-connector/core";
import { MagentoConfig } from "../types/magento.types.js";

/**
 * Dedicated REST client for the Magento 2 Admin API.
 * Handles:
 *  - Token-based authentication (cached via TokenStore)
 *  - Per-store-view request routing
 *  - Automatic exponential-back-off retries on transient errors
 *  - Base64 media uploads
 */
export class MagentoClient {
  private token: string = "";

  constructor(
    private readonly config: MagentoConfig,
    private readonly logger: Logger,
    private readonly tokenStore?: TokenStore,
  ) {}

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Authenticates with the Magento Admin API and caches the token.
   * If a token already exists in the TokenStore it will be reused.
   */
  async authenticate(): Promise<void> {
    // 1. Try pre-set token from config
    if (this.config.token) {
      this.token = this.config.token;
      this.logger.debug("Using pre-set Magento admin token from config.");
      return;
    }

    // 2. Try shared token store
    if (this.tokenStore) {
      const cached = await this.tokenStore.getToken("magento");
      if (cached) {
        this.token = cached;
        this.logger.debug("Reused existing Magento admin token from shared store.");
        return;
      }
    }

    // 3. Fetch a new token
    const url = this.buildUrl("/V1/integration/admin/token");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Magento authentication failed: ${response.status} ${response.statusText}\n${text}`,
      );
    }

    // The endpoint returns a plain JSON string (quoted token)
    const rawToken = (await response.json()) as unknown as string;
    this.token = rawToken;
    this.logger.info("Authenticated successfully with Magento.");

    // 4. Persist token — Magento admin tokens are valid for 4 h by default
    if (this.tokenStore) {
      await this.tokenStore.saveToken("magento", this.token, 3600 * 4);
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Issues a GET request to the Admin REST API.
   * @param path - API path, e.g. `/V1/products/MY-SKU`
   * @param storeCode - Optional store view code. Omit for global scope.
   */
  async get<T>(path: string, storeCode?: string): Promise<T> {
    return this.request<T>("GET", path, undefined, storeCode);
  }

  /**
   * Issues a POST request to the Admin REST API.
   */
  async post<T>(path: string, body: unknown, storeCode?: string): Promise<T> {
    return this.request<T>("POST", path, body, storeCode);
  }

  /**
   * Issues a PUT request to the Admin REST API.
   */
  async put<T>(path: string, body: unknown, storeCode?: string): Promise<T> {
    return this.request<T>("PUT", path, body, storeCode);
  }

  /**
   * Issues a DELETE request to the Admin REST API.
   */
  async delete<T>(path: string, storeCode?: string): Promise<T> {
    return this.request<T>("DELETE", path, undefined, storeCode);
  }

  // ---------------------------------------------------------------------------
  // Core request with retry
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    storeCode?: string,
  ): Promise<T> {
    const maxRetries = this.config.retries ?? 3;
    const initialDelay = this.config.retryDelayMs ?? 1000;

    const attempt = async (retriesLeft: number, delay: number): Promise<T> => {
      const url = this.buildUrl(path, storeCode);
      const init: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      };

      const response = await fetch(url, init);

      // Handle transient server errors with retry
      if (!response.ok) {
        if (retriesLeft > 0 && this.isTransientStatus(response.status)) {
          this.logger.debug(
            `Transient HTTP ${response.status} on ${method} ${path}. Retrying in ${delay}ms (${retriesLeft} left)`,
          );
          await sleep(delay);
          return attempt(retriesLeft - 1, delay * 2);
        }

        const text = await response.text();
        throw new Error(
          `Magento API error: ${method} ${path} → ${response.status} ${response.statusText}\n${text}`,
        );
      }

      // 204 No Content or empty body
      const text = await response.text();
      if (!text) return undefined as unknown as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    };

    return attempt(maxRetries, initialDelay);
  }

  // ---------------------------------------------------------------------------
  // URL builder
  // ---------------------------------------------------------------------------

  /**
   * Builds the full REST URL, optionally scoped to a store view.
   *
   * - Global scope (admin): `{base}/rest/all/V1/...`
   * - Store view scope:     `{base}/rest/{storeCode}/V1/...`
   *
   * Using the `all` store scope for writes ensures the change propagates to all
   * store views; per-store-view calls are made separately for localized fields.
   */
  private buildUrl(path: string, storeCode?: string): string {
    const base = this.config.url.replace(/\/$/, "");
    const store = storeCode ?? "all";
    return `${base}/rest/${store}${path}`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isTransientStatus(status: number): boolean {
    return [429, 500, 502, 503, 504].includes(status);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
