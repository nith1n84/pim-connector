/**
 * Canonical Data Model (CDM) for PIM-to-Commerce Integration
 */

export type LocalizedString = Record<string, string>;

export interface OptionGroup {
  id: string;
  code: string;
  name: LocalizedString;
  values: Option[];
}

export interface Option {
  id: string;
  code: string;
  name: LocalizedString;
  optionGroupId: string;
}

export interface Asset {
  id: string;
  url?: string;
  type: "image" | "document" | "other";
  altText?: string;
  mimeType?: string;
  buffer?: Buffer;
  name?: string;
}

export interface Price {
  amount: number;
  currency: string;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: AttributeValue[];
  attributes: Record<string, AttributeValue[]>;
  categories: string[];
  prices: Price[];
  assets: Asset[];
  optionValues?: {
    optionGroupId: string;
    optionId: string;
  }[];
}

export interface AttributeValue {
  value: string;
  type: string;
  locale: string | null;
  scope: string | null;
}

export interface Product {
  id: string;
  sku?: string; // Master SKU or Parent SKU
  name: AttributeValue[];
  description: AttributeValue[];
  enabled: boolean;
  categories: string[];
  attributes: Record<string, AttributeValue[]>;
  variants: ProductVariant[];
  assets: Asset[];
  assetFiles?: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }[];
  optionGroups?: OptionGroup[];
}

export interface Category {
  id: string;
  code: string; // Akeneo category code (maps to Vendure slug)
  name: LocalizedString;
  parentId: string | null; // For tree hierarchy
  position: number; // Order within parent
}

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Represents an Akeneo Family → maps to a Magento Attribute Set.
 */
export interface Family {
  /** Unique family code (e.g. "clothing", "electronics") */
  code: string;
  /** Human-readable labels keyed by locale */
  labels: Record<string, string>;
  /** All attribute codes that belong to this family */
  attributeCodes: string[];
  /** The attribute code used as the product label/name */
  attributeAsLabel: string;
  /** The attribute code used as the product main image, or null */
  attributeAsImage: string | null;
}

/**
 * Represents an Akeneo Attribute → maps to a Magento Attribute.
 * Options are NOT included here; they are synced separately via AttributeOption.
 */
export interface Attribute {
  /** Unique attribute code (e.g. "color", "size") */
  code: string;
  /** Akeneo attribute type (e.g. "pim_catalog_simpleselect") */
  type: string;
  /** Human-readable labels keyed by locale */
  labels: Record<string, string>;
  /** Whether the attribute value can differ per locale */
  localizable: boolean;
  /** Whether the attribute value can differ per channel/scope */
  scopable: boolean;
  /** Family codes that reference this attribute */
  familyCodes: string[];
}

/**
 * Represents a single option value for a select/multiselect Akeneo attribute.
 * Maps to a Magento Attribute Option.
 */
export interface AttributeOption {
  /** Option code (e.g. "red", "size_s") */
  code: string;
  /** The parent attribute code */
  attributeCode: string;
  /** Human-readable labels keyed by locale */
  labels: Record<string, string>;
  /** Sort position within the attribute's option list */
  sortOrder: number;
}

/**
 * Groups attribute options by their parent attribute code.
 * Used as the return type from source.getAttributeOptions().
 */
export interface AttributeOptionsGroup {
  attributeCode: string;
  options: AttributeOption[];
}
