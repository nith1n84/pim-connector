import { gql } from "graphql-request";

export interface VendureConfig {
  url: string;
  token?: string;
  email?: string;
  password?: string;
  retries?: number;
  retryDelayMs?: number;
  localeMap?: Record<string, string>;
  channelMap?: Record<string, string>;
  includeAttributes?: string[];
  excludeAttributes?: string[];
}

export const GET_PRODUCT_BY_VARIANT_SKU = gql`
  query GetProductByVariantSku($sku: String!) {
    productVariants(options: { filter: { sku: { eq: $sku } } }) {
      items {
        product {
          id
          name
          slug
          variants {
            id
            sku
          }
        }
      }
    }
  }
`;

export const CREATE_PRODUCT = gql`
  mutation CreateProduct($input: CreateProductInput!) {
    createProduct(input: $input) {
      id
      name
      slug
    }
  }
`;

export const UPDATE_PRODUCT = gql`
  mutation UpdateProduct($input: UpdateProductInput!) {
    updateProduct(input: $input) {
      id
      name
    }
  }
`;

export const CREATE_PRODUCT_VARIANTS = gql`
  mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
    createProductVariants(input: $input) {
      id
      sku
    }
  }
`;

export const UPDATE_PRODUCT_VARIANTS = gql`
  mutation UpdateProductVariants($input: [UpdateProductVariantInput!]!) {
    updateProductVariants(input: $input) {
      id
      sku
    }
  }
`;

export const LOGIN = gql`
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      ... on CurrentUser {
        id
        identifier
      }
      ... on InvalidCredentialsError {
        message
      }
    }
  }
`;

export const UPSERT_PRODUCT_ATTRIBUTES = gql`
  mutation UpsertProductAttributes($productId: ID!, $input: [UpsertProductAttributeInput!]!) {
    upsertProductAttributes(productId: $productId, input: $input) {
      id
      code
      value
    }
  }
`;

export const DELETE_PRODUCT_ATTRIBUTES = gql`
  mutation DeleteProductAttributesByProduct($productId: ID!) {
    deleteProductAttributesByProduct(productId: $productId)
  }
`;

export const GET_PRODUCT_ATTRIBUTES = gql`
  query GetProductAttributes($productId: ID!) {
    productAttributes(productId: $productId) {
      id
      code
      value
      type
      locale
      scope
    }
  }
`;

export const CREATE_PRODUCT_OPTION_GROUP = gql`
  mutation CreateProductOptionGroup($input: CreateProductOptionGroupInput!) {
    createProductOptionGroup(input: $input) {
      id
      code
      name
    }
  }
`;

export const CREATE_PRODUCT_OPTION = gql`
  mutation CreateProductOption($input: CreateProductOptionInput!) {
    createProductOption(input: $input) {
      id
      code
      name
      groupId
    }
  }
`;

export const ADD_OPTION_GROUP_TO_PRODUCT = gql`
  mutation AddOptionGroupToProduct($productId: ID!, $optionGroupId: ID!) {
    addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) {
      id
      name
      optionGroups {
        id
        code
        name
      }
    }
  }
`;
