import { Asset, AttributeDefinition, Product, SourceAdapter } from "@pim-connector/core";
import { AkeneoClient } from "./akeneo.client.js";
import { AkeneoMapper } from "./akeneo.mapper.js";
import { AkeneoConfig, AkeneoProduct } from "./akeneo.types.js";

export class AkeneoAdapter implements SourceAdapter {
  readonly name = "akeneo";
  private client: AkeneoClient;
  private mapper: AkeneoMapper;
  private attributeDefinitions: Map<string, AttributeDefinition> = new Map();

  constructor(config: AkeneoConfig) {
    this.client = new AkeneoClient(config);
    this.mapper = new AkeneoMapper(config.locales, config.scopes);
  }

  async initialize(): Promise<void> {
    console.log("Initializing Akeneo Adapter...");
    const rawDefinitions = await this.client.getAttributeDefinitions();

    for (const raw of rawDefinitions) {
      this.attributeDefinitions.set(raw.code, {
        code: raw.code,
        akeneoType: raw.type,
        cdmType: this.mapAkeneoTypeToCdmType(raw.type),
        localisable: !!raw.localizable,
        scopable: !!raw.scopable,
      });
    }

    this.mapper.setAttributeDefinitions(this.attributeDefinitions);
    console.log(
      `Akeneo Adapter initialized with ${this.attributeDefinitions.size} attribute definitions`,
    );
  }

  private mapAkeneoTypeToCdmType(akeneoType: string): AttributeDefinition["cdmType"] {
    switch (akeneoType) {
      case "pim_catalog_boolean":
        return "boolean";
      case "pim_catalog_number":
        return "number";
      case "pim_catalog_multiselect":
      case "pim_catalog_asset_collection":
      case "pim_catalog_price_collection":
        return "array";
      case "pim_catalog_metric":
        return "object";
      default:
        return "string";
    }
  }

  async getProducts(): Promise<Product[]> {
    const products: Product[] = [];
    const iterator = this.client.paginate<AkeneoProduct>("/api/rest/v1/products");

    for await (const items of iterator) {
      for (const item of items) {
        if (item.parent) {
          // todo: handle variant products later here !!
          continue;
        }

        products.push(this.mapper.mapToProduct(item));
      }
    }
    return products;
  }

  async getProduct(id: string): Promise<Product | null> {
    try {
      const akeneoProduct = await this.client.request<AkeneoProduct>({
        url: `/api/rest/v1/products/${id}`,
        method: "GET",
      });
      return this.mapper.mapToProduct(akeneoProduct);
    } catch (error) {
      return null;
    }
  }

  async getUpdatedProducts(since: Date): Promise<Product[]> {
    const products: Product[] = [];

    const searchFilter = {
      updated: [
        {
          operator: ">",
          value: this.formatAkeneoDate(since),
        },
      ],
    };

    const iterator = this.client.paginate<AkeneoProduct>("/api/rest/v1/products", {
      search: JSON.stringify(searchFilter),
    });

    for await (const items of iterator) {
      products.push(...items.map((item) => this.mapper.mapToProduct(item)));
    }

    return products;
  }

  private formatAkeneoDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");

    return (
      date.getUTCFullYear() +
      "-" +
      pad(date.getUTCMonth() + 1) +
      "-" +
      pad(date.getUTCDate()) +
      " " +
      pad(date.getUTCHours()) +
      ":" +
      pad(date.getUTCMinutes()) +
      ":" +
      pad(date.getUTCSeconds())
    );
  }

  async getAssets(): Promise<Asset[]> {
    // Asset Manager API is separate, placeholder for now
    return [];
  }
}
