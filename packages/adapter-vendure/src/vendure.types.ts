import { gql } from 'graphql-request';

export interface VendureConfig {
  url: string;
  token: string;
}

export const GET_PRODUCT_BY_SKU = gql`
  query GetProductBySku($sku: String!) {
    products(options: { filter: { sku: { eq: $sku } } }) {
      items {
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
