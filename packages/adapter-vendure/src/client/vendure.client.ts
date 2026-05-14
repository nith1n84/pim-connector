import { GraphQLClient } from "graphql-request";
import { Logger } from "@pim-connector/core";
import { LOGIN, CREATE_ASSETS, VendureConfig } from "../types/vendure.types.js";

/**
 * Dedicated client for interacting with the Vendure Admin API.
 * Handles authentication, request retries, and multi-part file uploads.
 */
export class VendureClient {
  private readonly client: GraphQLClient;
  private token: string = "";

  constructor(
    private readonly config: VendureConfig,
    private readonly logger: Logger,
  ) {
    this.client = new GraphQLClient(config.url);
    if (config.token) {
      this.setAuthToken(config.token);
    }
  }

  /**
   * Sets the authentication token for subsequent requests.
   */
  setAuthToken(token: string): void {
    this.client.setHeader("Authorization", `Bearer ${token}`);
    this.client.setHeader("vendure-auth-token", token);
    this.token = token;
  }

  /**
   * Authenticates with Vendure using email and password.
   */
  async authenticate(): Promise<void> {
    if (!this.config.email || !this.config.password) {
      return;
    }

    try {
      const resp = await this.client.rawRequest<any>(LOGIN, {
        username: this.config.email,
        password: this.config.password,
      });

      const token = resp.headers.get("vendure-auth-token");
      if (token) {
        this.setAuthToken(token);
        this.logger.info("Authenticated successfully with Vendure.");
      } else {
        this.logger.debug("Login successful but no token received in headers.");
      }
    } catch (error) {
      this.logger.error("Vendure authentication failed:", error);
    }
  }

  /**
   * Executes a GraphQL request with automatic retries for transient errors.
   */
  async request<T>(query: string, variables?: any): Promise<T> {
    const maxRetries = this.config.retries ?? 3;
    const initialDelay = this.config.retryDelayMs ?? 1000;

    const attempt = async (remRetries: number, currentDelay: number): Promise<T> => {
      try {
        return await this.client.request<T>(query, variables);
      } catch (error: any) {
        if (remRetries > 0 && this.isTransientError(error)) {
          const reason = this.getTransientReason(error);
          this.logger.debug(
            `Transient error (${reason}). Retrying in ${currentDelay}ms... (${remRetries} attempts left)`,
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
   * Uploads a file to Vendure as an asset.
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType = "image/png",
  ): Promise<string[]> {
    const form = new FormData();

    form.append(
      "operations",
      JSON.stringify({
        query: CREATE_ASSETS,
        variables: {
          input: [{ file: null }],
        },
      }),
    );

    form.append(
      "map",
      JSON.stringify({ "1": ["variables.input.0.file"] }),
    );

    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    form.append("1", blob, filename);

    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "vendure-auth-token": this.token,
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vendure upload failed: ${response.status} ${response.statusText}\n${text}`);
    }

    const json: any = await response.json();
    if (json.errors) {
      throw new Error(JSON.stringify(json.errors, null, 2));
    }

    const assets = json.data?.createAssets ?? [];
    return assets.map((asset: any) => asset.id);
  }

  /**
   * Identifies if an error is transient and should be retried.
   */
  private isTransientError(error: any): boolean {
    const message = error.message?.toLowerCase() || "";

    // 1. Database Lock Errors
    if (
      message.includes("database is locked") ||
      message.includes("deadlock detected") ||
      message.includes("lock wait timeout exceeded")
    ) {
      return true;
    }

    // 2. Common Network Errors
    const transientNetworkCodes = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENOTFOUND"];
    if (transientNetworkCodes.some((code) => message.includes(code.toLowerCase()))) {
      return true;
    }

    // 3. HTTP Status Codes
    const status = error.response?.status;
    return !!(status && [429, 502, 503, 504].includes(status));
  }

  /**
   * Extracts a concise reason for a transient error.
   */
  private getTransientReason(error: any): string {
    const message = error.message?.toLowerCase() || "";
    if (message.includes("database is locked")) return "Database Locked (SQLite)";
    if (message.includes("deadlock detected")) return "Database Deadlock (Postgres)";
    if (message.includes("lock wait timeout exceeded")) return "Lock Wait Timeout (MySQL)";

    if (error.code) return `Network Error (${error.code})`;
    const status = error.response?.status;
    if (status) return `HTTP Error (${status})`;

    return message.length > 100 ? message.substring(0, 100) + "..." : message;
  }
}
