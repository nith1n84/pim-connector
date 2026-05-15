import { StorageProvider } from "../storage/storage.interface.js";

export interface AuthToken {
  token: string;
  refreshToken?: string;
  expiry?: number; // Unix timestamp in seconds
}

/**
 * Service for persisting and sharing authentication tokens across instances.
 */
export class TokenStore {
  constructor(private readonly provider: StorageProvider) {}

  /**
   * Saves a token for a specific adapter.
   */
  async saveToken(
    adapterName: string,
    token: string,
    expiresInSeconds?: number,
    refreshToken?: string,
  ): Promise<void> {
    const key = this.generateKey(adapterName);
    const authToken: AuthToken = {
      token,
      refreshToken,
      expiry: expiresInSeconds ? Math.floor(Date.now() / 1000) + expiresInSeconds : undefined,
    };
    await this.provider.write(key, JSON.stringify(authToken, null, 2));
  }

  /**
   * Retrieves a full token object for a specific adapter.
   */
  async getAuthToken(adapterName: string): Promise<AuthToken | null> {
    const key = this.generateKey(adapterName);
    const data = await this.provider.read(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Retrieves a valid access token string for a specific adapter.
   */
  async getToken(adapterName: string): Promise<string | null> {
    const authToken = await this.getAuthToken(adapterName);
    if (!authToken) return null;

    if (authToken.expiry && authToken.expiry < Math.floor(Date.now() / 1000) + 60) {
      return null;
    }
    return authToken.token;
  }

  private generateKey(adapterName: string): string {
    return `.sync-data/auth/${adapterName}-token.json`;
  }
}
