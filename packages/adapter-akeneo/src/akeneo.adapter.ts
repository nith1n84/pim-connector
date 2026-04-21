import { Asset, AttributeDefinition, Product, SourceAdapter } from "@pim-connector/core";
import { AkeneoClient } from "./akeneo.client.js";
import { AkeneoMapper } from "./akeneo.mapper.js";
import { AkeneoConfig, AkeneoProduct } from "./akeneo.types.js";

export class AkeneoAdapter implements SourceAdapter {
  readonly name = "akeneo";
  private client: AkeneoClient;
  private mapper: AkeneoMapper;
  private attributeDefinitions: Map<string, AttributeDefinition> = new Map();
  private familyMappings: Map<string, { labelAttribute: string; imageAttribute: string | null }> =
    new Map();

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

    // Fetch and cache family mappings
    const families = await this.client.getFamilies();
    for (const family of families) {
      this.familyMappings.set(family.code, {
        labelAttribute: family.attribute_as_label || "name",
        imageAttribute: family.attribute_as_image || null,
      });
    }

    this.mapper.setAttributeDefinitions(this.attributeDefinitions);
    this.mapper.setFamilyMappings(this.familyMappings);

    console.log(
      `Akeneo Adapter initialized with ${this.attributeDefinitions.size} attribute definitions and ${this.familyMappings.size} family mappings`,
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

    if (this.familyMappings.size === 0) {
      console.warn("No family mappings available. Please ensure families are properly loaded.");
      return products;
    }

    // Process each family separately
    for (const [familyCode, familyMapping] of this.familyMappings) {
      try {
        console.log(`Fetching products for family: ${familyCode}`);

        const searchFilter = {
          family: [
            {
              operator: "IN",
              value: [familyCode],
            },
          ],
        };

        const iterator = this.client.paginate<AkeneoProduct>("/api/rest/v1/products", {
          search: JSON.stringify(searchFilter),
        });

        let familyProductCount = 0;
        for await (const items of iterator) {
          for (const item of items) {
            if (item.parent) {
              // todo: handle variant products later here !!
              continue;
            }

            products.push(this.mapper.mapToProduct(item, familyMapping));
            familyProductCount++;
          }
        }

        console.log(`Fetched ${familyProductCount} products from family: ${familyCode}`);
      } catch (error) {
        console.error(`Failed to fetch products for family ${familyCode}:`, error);
        // Continue with other families even if one fails
        continue;
      }
    }

    console.log(`Fetched total of ${products.length} products from all families`);
    return products;
  }

  async getProduct(id: string): Promise<Product | null> {
    try {
      const akeneoProduct = await this.client.request<AkeneoProduct>({
        url: `/api/rest/v1/products/${id}`,
        method: "GET",
      });

      // Get family mapping for this product
      const familyMapping = akeneoProduct.family
        ? this.familyMappings.get(akeneoProduct.family)
        : undefined;

      return this.mapper.mapToProduct(akeneoProduct, familyMapping);
    } catch (error) {
      return null;
    }
  }

  async getUpdatedProducts(since: Date): Promise<Product[]> {
    const products: Product[] = [];

    if (this.familyMappings.size === 0) {
      console.warn("No family mappings available. Please ensure families are properly loaded.");
      return products;
    }

    // Process each family separately for updated products
    for (const [familyCode, familyMapping] of this.familyMappings) {
      try {
        const searchFilter = {
          family: [
            {
              operator: "IN",
              value: [familyCode],
            },
          ],
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

        let familyUpdatedCount = 0;
        for await (const items of iterator) {
          for (const item of items) {
            if (item.parent) {
              // todo: handle variant products later here !!
              continue;
            }
            products.push(this.mapper.mapToProduct(item, familyMapping));
            familyUpdatedCount++;
          }
        }

        if (familyUpdatedCount > 0) {
          console.log(`Found ${familyUpdatedCount} updated products in family: ${familyCode}`);
        }
      } catch (error) {
        console.error(`Failed to fetch updated products for family ${familyCode}:`, error);
        // Continue with other families even if one fails
        continue;
      }
    }

    console.log(`Found total of ${products.length} updated products`);
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
