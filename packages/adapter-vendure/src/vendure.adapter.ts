import { GraphQLClient } from "graphql-request";
import { Asset, Product, TargetAdapter } from "@pim-connector/core";
import {
  CREATE_PRODUCT,
  CREATE_PRODUCT_VARIANTS,
  GET_PRODUCT_BY_VARIANT_SKU,
  LOGIN,
  UPDATE_PRODUCT,
  UPDATE_PRODUCT_VARIANTS,
  UPSERT_PRODUCT_ATTRIBUTES,
  VendureConfig,
} from "./vendure.types.js";
import { VendureMapper } from "./vendure.mapper.js";

export class VendureAdapter implements TargetAdapter {
  readonly name = "vendure";
  private client: GraphQLClient;
  private mapper: VendureMapper;

  constructor(private config: VendureConfig) {
    this.client = new GraphQLClient(config.url);
    if (config.token) {
      this.setAuthToken(config.token);
    }
    this.mapper = new VendureMapper(config);
  }

  private setAuthToken(token: string) {
    this.client.setHeader("Authorization", `Bearer ${token}`);
    this.client.setHeader("vendure-auth-token", token);
  }

  async initialize(): Promise<void> {
    if (this.config.email && this.config.password) {
      console.log("Authenticating with Vendure...");
      try {
        const resp = await this.client.rawRequest<any>(LOGIN, {
          username: this.config.email,
          password: this.config.password,
        });

        const token = resp.headers.get("vendure-auth-token");
        if (token) {
          this.setAuthToken(token);
          console.log("Authenticated successfully via login.");
        } else {
          console.warn("Login successful but no token received in headers.");
        }
      } catch (error) {
        console.error("Vendure authentication failed:", error);
      }
    }
    console.log("Vendure Adapter initialized");
  }

  private async requestWithRetry<T>(query: string, variables: any): Promise<T> {
    const maxRetries = this.config.retries ?? 3;
    const initialDelay = this.config.retryDelayMs ?? 1000;

    const attempt = async (remRetries: number, currentDelay: number): Promise<T> => {
      try {
        return await this.client.request<T>(query, variables);
      } catch (error: any) {
        if (remRetries > 0 && error.message?.includes("database is locked")) {
          console.warn(
            `Database locked, retrying in ${currentDelay}ms... (${remRetries} attempts left)`,
          );
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
          return attempt(remRetries - 1, currentDelay * 2);
        }
        throw error;
      }
    };

    return attempt(maxRetries, initialDelay);
  }

  async upsertProduct(product: Product, targetId?: string): Promise<string> {
    const existingProduct = targetId ? { id: targetId } : await this.findProductBySku(product.sku);

    let productId: string;
    if (existingProduct) {
      console.log(`Updating existing product ${product.sku} (ID: ${existingProduct.id})`);
      const updateInput = this.mapper.mapToUpdateProductInput(existingProduct.id, product);
      await this.requestWithRetry(UPDATE_PRODUCT, { input: updateInput });
      productId = existingProduct.id;
    } else {
      console.log(`Creating new producttt ${product.sku}`);
      const createInput = this.mapper.mapToCreateProductInput(product);

      const resp = await this.requestWithRetry<{ createProduct: { id: string } }>(CREATE_PRODUCT, {
        input: createInput,
      });
      productId = resp.createProduct.id;
    }

    // Handle Variants
    if (product.variants && product.variants.length > 0) {
      await this.upsertVariants(productId, product.variants, (existingProduct as any)?.variants);
    }

    // Handle Custom Attributes
    if (product.attributes && Object.keys(product.attributes).length > 0) {
      console.log(`Syncing custom attributes for product ${product.sku}`);
      const attributeInputs = this.mapper.mapToProductAttributeInputs(
        productId,
        product.attributes,
        {
          includeAttributes: this.config.includeAttributes,
          excludeAttributes: this.config.excludeAttributes,
        },
      );

      if (attributeInputs.length > 0) {
        await this.requestWithRetry(UPSERT_PRODUCT_ATTRIBUTES, {
          productId,
          input: attributeInputs,
        });
      }
    }

    return productId;
  }

  private async findProductBySku(sku: string): Promise<any | null> {
    try {
      const resp = await this.client.request<{
        productVariants: { items: any[] };
      }>(GET_PRODUCT_BY_VARIANT_SKU, { sku });
      return resp.productVariants.items[0]?.product || null;
    } catch (error) {
      console.error(`Error finding product by SKU ${sku}:`, error);
      return null;
    }
  }

  private async upsertVariants(
    productId: string,
    variants: any[],
    existingVariants: any[] = [],
  ): Promise<void> {
    const toCreate = [];
    const toUpdate = [];

    for (const variant of variants) {
      const existing = existingVariants.find((v) => v.sku === variant.sku);
      if (existing) {
        toUpdate.push(this.mapper.mapToUpdateVariantInput(existing.id, variant));
      } else {
        toCreate.push(this.mapper.mapToCreateVariantInput(productId, variant));
      }
    }

    if (toCreate.length > 0) {
      await this.requestWithRetry(CREATE_PRODUCT_VARIANTS, { input: toCreate });
    }
    if (toUpdate.length > 0) {
      await this.requestWithRetry(UPDATE_PRODUCT_VARIANTS, { input: toUpdate });
    }
  }

  async upsertAsset(asset: Asset): Promise<void> {
    console.log(`Upserting asset ${asset.url} to Vendure... (Not fully implemented)`);
    // TODO: Implement asset upload via Admin API
  }
}
