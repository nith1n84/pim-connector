/**
 * Canonical Data Model (CDM) for PIM-to-Commerce Integration
 */

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
  name: string;
  attributes: Record<string, any>;
  prices: Price[];
  assets: Asset[];
}

export interface Product {
  id: string;
  sku: string; // Master SKU or Parent SKU
  name: string;
  description: string;
  enabled: boolean;
  categories: string[];
  attributes: Record<string, any>;
  variants: ProductVariant[];
  assets: Asset[];
}
