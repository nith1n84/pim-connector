import { IdentityMap, TokenStore } from "@pim-connector/core";

/**
 * Configuration interface for the Magento 2 target adapter.
 */
export interface MagentoConfig {
  /** Magento base URL, e.g. https://store.example.com */
  url: string;

  /** Admin username for token-based authentication */
  username: string;

  /** Admin password for token-based authentication */
  password: string;

  /** Pre-set admin token (skips auth flow if provided) */
  token?: string;

  /**
   * Default store view code for base product data.
   * Defaults to "default".
   */
  storeCode?: string;

  /**
   * Root category ID in Magento under which all imported categories are created.
   * Defaults to 2 (Magento's standard "Default Category").
   */
  rootCategoryId?: number;

  /**
   * Attribute set strategy: maps Akeneo family code → Magento attribute set name.
   * If a family is not listed, falls back to defaultAttributeSetName.
   * Example: { "clothing": "Clothing", "electronics": "Electronics" }
   */
  familyAttributeSetMap?: Record<string, string>;

  /**
   * Fallback attribute set name when family is not in familyAttributeSetMap.
   * Defaults to "Default".
   */
  defaultAttributeSetName?: string;

  /**
   * List of Akeneo attribute codes that act as configurable axes in Magento.
   * These become the super_attributes on configurable products.
   * Example: ["size", "color"]
   */
  configurableAttributes?: string[];

  /**
   * Maps Akeneo locale codes → Magento store view codes.
   * Base product data is written to the default store.
   * Localized fields are then written per store view.
   * Example: { "en_US": "default", "fr_FR": "french", "de_DE": "german" }
   */
  localeMap?: Record<string, string>;

  /** Number of retries for transient HTTP errors. Defaults to 3. */
  retries?: number;

  /** Initial retry delay in ms (exponential back-off). Defaults to 1000. */
  retryDelayMs?: number;

  /** Identity map for product/category source→target ID tracking. */
  categoryIdentityMap: IdentityMap;

  /** Identity map for asset source→target ID tracking. */
  assetIdentityMap: IdentityMap;

  /** Shared token store for caching the admin token across runs. */
  tokenStore?: TokenStore;
}

// ---------------------------------------------------------------------------
// Magento REST payload shapes (subset — extended per service as needed)
// ---------------------------------------------------------------------------

export interface MagentoProduct {
  id: number;
  sku: string;
  name: string;
  attribute_set_id: number;
  type_id: "simple" | "configurable" | "virtual" | "bundle" | "grouped";
  status: number; // 1=enabled, 2=disabled
}

export interface MagentoCategory {
  id: number;
  parent_id: number;
  name: string;
  is_active: boolean;
}

export interface MagentoAttributeSet {
  attribute_set_id: number;
  attribute_set_name: string;
}

export interface MagentoAttribute {
  attribute_id: number;
  attribute_code: string;
  frontend_labels: { store_id: number; label: string }[];
  options?: MagentoAttributeOption[];
}

export interface MagentoAttributeOption {
  value: string;
  label: string;
  store_labels?: { store_id: number; label: string }[];
}

export interface MagentoMediaEntry {
  id?: number;
  media_type: "image";
  label: string;
  position: number;
  disabled: boolean;
  types: string[];
  file?: string;
  content?: {
    base64_encoded_data: string;
    type: string;
    name: string;
  };
}
