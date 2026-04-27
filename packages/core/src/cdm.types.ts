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
  url: string;
  type: "image" | "document" | "other";
  altText?: string;
  mimeType?: string;
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

export interface AttributeDefinition {
  code: string;
  akeneoType: string;
  cdmType: "string" | "boolean" | "number" | "array" | "object";
  localisable: boolean;
  scopable: boolean;
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
  optionGroups?: OptionGroup[];
}

export interface Category {
  id: string;
  code: string; // Akeneo category code (maps to Vendure slug)
  name: LocalizedString;
  parentId: string | null; // For tree hierarchy
  position: number; // Order within parent
}
