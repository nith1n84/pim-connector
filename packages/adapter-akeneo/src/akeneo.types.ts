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
}

export interface AkeneoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
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

export interface AkeneoAttributeValue {
  locale: string | null;
  scope: string | null;
  data: any;
  linked_data?: any;
  attribute_type: string;
  reference_data_name?: string;
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
}
