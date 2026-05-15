import { StorageProvider } from "../storage/storage.interface.js";

export interface AuthToken {
  token: string;
  expiry?: number; // Unix timestamp in seconds
}

/**
 * Service for persisting and sharing authentication tokens across instances.
 */
export class TokenStore {
  constructor(private readonly provider: StorageProvider) {}

  /**
   * Saves a token for a specific adapter.
   * @param adapterName - Name of the adapter (e.g., 'akeneo', 'vendure').
   * @param token - The token string.
   * @param expiresInSeconds - Optional duration until the token expires.
   */
  async saveToken(adapterName: string, token: string, expiresInSeconds?: number): Promise<void> {
    const key = this.generateKey(adapterName);
    const authToken: AuthToken = {
      token,
      expiry: expiresInSeconds ? Math.floor(Date.now() / 1000) + expiresInSeconds : undefined,
    };
    await this.provider.write(key, JSON.stringify(authToken, null, 2));
  }

  /**
   * Retrieves a valid token for a specific adapter.
   * Returns null if no token exists or if it has expired.
   */
  async getToken(adapterName: string): Promise<string | null> {
    const key = this.generateKey(adapterName);
    const data = await this.provider.read(key);
    if (!data) return null;

    try {
      const authToken: AuthToken = JSON.parse(data);
      if (authToken.expiry && authToken.expiry < Math.floor(Date.now() / 1000) + 60) {
        // Expired or expiring within 60 seconds
        return null;
      }
      return authToken.token;
    } catch {
      return null;
    }
  }

  private generateKey(adapterName: string): string {
    return `.sync-data/auth/${adapterName}-token.json`;
  }
}
