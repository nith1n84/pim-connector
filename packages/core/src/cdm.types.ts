/**
 * Canonical Data Model (CDM) for PIM-to-Commerce Integration
 */

export type LocalizedString = Record<string, string>;

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
}

export interface AttributeValue {
  value: string;
  type: string;
  locale: string | null;
  scope: string | null;
}

export interface Product {
  id: string;
  sku: string; // Master SKU or Parent SKU
  name: AttributeValue[];
  description: AttributeValue[];
  enabled: boolean;
  categories: string[];
  attributes: Record<string, AttributeValue[]>;
  variants: ProductVariant[];
  assets: Asset[];
}
