import { SourceAdapter, Product, Asset } from "@pim-connector/core";
import { AkeneoClient } from "./akeneo.client.js";
import { AkeneoMapper } from "./akeneo.mapper.js";
import { AkeneoConfig, AkeneoProduct } from "./akeneo.types.js";

export class AkeneoAdapter implements SourceAdapter {
  readonly name = "akeneo";
  private client: AkeneoClient;
  private mapper: AkeneoMapper;

  constructor(private config: AkeneoConfig) {
    this.client = new AkeneoClient(config);
    this.mapper = new AkeneoMapper(config.locale, config.scope);
  }

  async initialize(): Promise<void> {
    // Client handles initialization/auth lazily, but we can verify it here
    console.log("Akeneo Adapter initialized");
  }

  async getProducts(): Promise<Product[]> {
    const products: Product[] = [];
    const iterator = this.client.paginate<AkeneoProduct>(
      "/api/rest/v1/products",
    );

    for await (const items of iterator) {
      const mapped = items.map((item) => this.mapper.mapToProduct(item));
      products.push(...mapped);
    }

    return products;
  }

  async getProduct(id: string): Promise<Product | null> {
    try {
      const resp = await this.client.request<AkeneoProduct>({
        url: `/api/rest/v1/products/${id}`,
        method: "GET",
      });
      return this.mapper.mapToProduct(resp);
    } catch (error) {
      return null;
    }
  }

  async getUpdatedProducts(since: Date): Promise<Product[]> {
    const products: Product[] = [];
    // Akeneo filters use JSON format in query params
    const searchFilter = {
      updated: [
        {
          operator: ">",
          value: since.toISOString().split(".")[0], // Format: YYYY-MM-DDTHH:mm:ss
        },
      ],
    };

    const iterator = this.client.paginate<AkeneoProduct>(
      "/api/rest/v1/products",
      {
        search: JSON.stringify(searchFilter),
      },
    );

    for await (const items of iterator) {
      const mapped = items.map((item) => this.mapper.mapToProduct(item));
      products.push(...mapped);
    }

    return products;
  }

  async getAssets(): Promise<Asset[]> {
    // Asset Manager API is separate, placeholder for now
    return [];
  }
}
