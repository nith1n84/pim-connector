import { Asset, Category, Product } from "./cdm.types.js";

export interface SourceAdapter {
  name: string;
  initialize(): Promise<void>;
  getProducts(): Promise<any[]>;
  getProduct(id: string): Promise<any | null>;
  getUpdatedProducts(since: Date): Promise<any[]>;
  getAssets(): Promise<any[]>;
  getCategories(): Promise<Category[]>;
}

export interface TargetAdapter {
  name: string;
  initialize(): Promise<void>;
  upsertProduct(product: Product, targetId?: string): Promise<string>;
  upsertAsset(asset: Asset): Promise<void>;
  upsertCollection(
    category: Category,
    targetId?: string,
    parentCollectionIdMap?: Map<string, string>,
  ): Promise<string>;
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
