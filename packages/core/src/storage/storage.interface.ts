/**
 * Interface for persistence providers.
 * Allows the system to swap storage backends (File, S3, etc.) easily.
 */
export interface StorageProvider {
  /**
   * Reads data from storage for the given key.
   */
  read(key: string): Promise<string | null>;

  /**
   * Writes data to storage for the given key.
   */
  write(key: string, data: string): Promise<void>;

  /**
   * Checks if a key exists in storage.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Deletes a key from storage.
   */
  delete(key: string): Promise<void>;
}
