import {
  Attribute,
  AttributeOption,
  AttributeOptionsGroup,
  Category,
  Family,
  Product,
} from "./cdm.types.js";

export interface SourceAdapter {
  name: string;
  initialize(): Promise<void>;
  fetchProducts(
    page: number,
    limit: number,
    since?: Date,
    identifiers?: string[],
  ): Promise<Product[]>;
  getProduct(id: string): Promise<any | null>;
  getAssets(): Promise<any[]>;
  getCategories(): Promise<Category[]>;

  // ── Schema sync (optional — only implemented by adapters that support it) ──

  /** Fetch all Akeneo families. Each family maps to a Magento Attribute Set. */
  getFamilies?(): Promise<Family[]>;

  /**
   * Fetch all attributes across all families (deduplicated).
   * @param familyCodes - If provided, only fetch attributes used by these families.
   */
  getAttributes?(familyCodes?: string[]): Promise<Attribute[]>;

  /**
   * Fetch all attribute options for select/multiselect attributes.
   * @param attributeCodes - Attribute codes to fetch options for.
   */
  getAttributeOptions?(attributeCodes: string[]): Promise<AttributeOptionsGroup[]>;
}

export interface TargetAdapter {
  name: string;
  initialize(): Promise<void>;
  upsertProduct(product: Product, targetId?: string): Promise<string>;
  upsertCollection(
    category: Category,
    targetId?: string,
    parentCollectionIdMap?: Map<string, string>,
  ): Promise<string>;

  // ── Schema sync (optional — only implemented by Magento-style targets) ──

  /** Create or update a Magento Attribute Set from an Akeneo Family. */
  upsertAttributeSet?(family: Family, targetId?: string): Promise<string>;

  /** Create or update a Magento Attribute from an Akeneo Attribute. */
  upsertAttribute?(attribute: Attribute, targetId?: string): Promise<string>;

  /** Create or update all options for a single Magento select/multiselect attribute. */
  upsertAttributeOptions?(options: AttributeOption[], attributeCode: string): Promise<void>;

  /**
   * Assign a list of attribute codes to an attribute set.
   * @param attributeSetId - The target Magento attribute set ID.
   * @param attributeCodes - Attribute codes to assign.
   */
  assignAttributesToSet?(attributeSetId: string, attributeCodes: string[]): Promise<void>;
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
