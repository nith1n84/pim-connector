import { StorageProvider } from "./storage.interface.js";
import { FileStorageProvider } from "./file-storage.js";
import { S3StorageConfig, S3StorageProvider } from "./s3-storage.js";

export type StoreConfig =
  | { type: "local"; config: { baseDir: string } }
  | { type: "s3"; config: S3StorageConfig };

export function createStorageProvider(config: StoreConfig): StorageProvider {
  if (config.type === "local") {
    return new FileStorageProvider(config.config.baseDir);
  } else if (config.type === "s3") {
    return new S3StorageProvider(config.config);
  }

  throw new Error(`Unsupported storage type: ${(config as any).type}`);
}
