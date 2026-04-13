import { Product, Asset } from "./cdm.types.js";

export interface SourceAdapter {
  name: string;
  initialize(): Promise<void>;
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  getUpdatedProducts(since: Date): Promise<Product[]>;
  getAssets(): Promise<Asset[]>;
}

export interface TargetAdapter {
  name: string;
  initialize(): Promise<void>;
  upsertProduct(product: Product): Promise<void>;
  upsertAsset(asset: Asset): Promise<void>;
}

export interface SyncContext {
  source: SourceAdapter;
  target: TargetAdapter;
  logger: Logger;
}

export interface Logger {
  info(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}
