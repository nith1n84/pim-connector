/**
 * Akeneo API Types
 */

export interface AkeneoConfig {
  url: string;
  clientId: string;
  secret: string;
  username?: string;
  password?: string;
  locales: string[];
  scopes: string[];
  syncCategories?: boolean;
  categoryRootCode?: string;
}

export interface AkeneoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
}

export interface AkeneoAttributeValue {
  locale: string | null;
  scope: string | null;
  data: any;
  linked_data?: any;
  attribute_type: string;
  reference_data_name?: string;
}

export interface AkeneoProduct {
  identifier: string;
  family?: string;
  parent?: string;
  groups?: string[];
  categories?: string[];
  enabled: boolean;
  values: Record<string, AkeneoAttributeValue[]>;
  created?: string;
  updated?: string;
  associations?: Record<string, any>;
  quantified_associations?: Record<string, any>;
}

export interface AkeneoProductModel {
  code: string;
  family: string;
  family_variant: string;
  parent?: string;
  categories?: string[];
  values: Record<string, AkeneoAttributeValue[]>;
  created?: string;
  updated?: string;
  associations?: Record<string, any>;
  quantified_associations?: Record<string, any>;
}

export interface AkeneoFamily {
  code: string;
  labels: Record<string, string>;
  attribute_as_label: string;
  attribute_as_image: string | null;
}

export interface AkeneoAttribute {
  code: string;
  type: string;
  labels: Record<string, string>;
  localizable: boolean;
  scopable: boolean;
  group: string;
}

export interface AkeneoAttributeOption {
  code: string;
  attribute: string;
  sort_order: number;
  labels: Record<string, string>;
}

export interface AkeneoFamilyVariant {
  code: string;
  labels: Record<string, string>;
  variant_attribute_sets: {
    level: number;
    axes: string[];
    attributes: string[];
  }[];
  common_attributes: string[];
}

export interface AkeneoPagingResponse<T> {
  _links: {
    self: { href: string };
    first: { href: string };
    next?: { href: string };
  };
  _embedded: {
    items: T[];
  };
  current_page: number;
  items_count: number;
}

export interface AkeneoCategory {
  code: string;
  parent: string | null;
  labels: Record<string, string>;
  updated: string;
}

export interface AkeneoAssetFamily {
  code: string;
  labels: Record<string, string>;
  attribute_as_main_media: string;
}
