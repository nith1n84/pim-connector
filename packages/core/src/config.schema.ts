import { z } from "zod";

export const SourceAkeneoSchema = z.object({
  adapter: z.literal("akeneo"),
  config: z.object({
    url: z.url(),
    clientId: z.string(),
    secret: z.string(),
    username: z.string(),
    password: z.string(),
    locales: z.array(z.string()),
    scopes: z.array(z.string()),
  }),
});

export const TargetVendureSchema = z.object({
  adapter: z.literal("vendure"),
  config: z.object({
    url: z.url(),
    email: z.string().optional(),
    password: z.string().optional(),

    localeMap: z.record(z.string(), z.string()),
    channelMap: z.record(z.string(), z.string()),
  }),
});

export const TargetMagentoSchema = z.object({
  adapter: z.literal("magento"),
  config: z.object({
    url: z.url(),
    username: z.string(),
    password: z.string(),
    token: z.string().optional(),

    /** Default store view code for base product data. Defaults to "default". */
    storeCode: z.string().optional(),

    /**
     * Root category ID under which all imported categories are placed.
     * Defaults to 2 (Magento standard root).
     */
    rootCategoryId: z.number().optional(),

    /**
     * Maps Akeneo family codes → Magento attribute set names.
     * Example: { "clothing": "Clothing", "electronics": "Electronics" }
     */
    familyAttributeSetMap: z.record(z.string(), z.string()).optional(),

    /**
     * Fallback attribute set name when family is not in familyAttributeSetMap.
     * Defaults to "Default".
     */
    defaultAttributeSetName: z.string().optional(),

    /**
     * Akeneo attribute codes that are configurable axes.
     * Example: ["size", "color"]
     */
    configurableAttributes: z.array(z.string()).optional(),

    /**
     * Maps Akeneo locale codes → Magento store view codes.
     * Base product data goes to default; localized fields go per store view.
     * Example: { "en_US": "default", "fr_FR": "french", "de_DE": "german" }
     */
    localeMap: z.record(z.string(), z.string()).optional(),

    retries: z.number().optional(),
    retryDelayMs: z.number().optional(),
  }),
});

export const MappingSchema = z.object({
  attributeMap: z
    .record(
      z.string(),
      z.string().or(
        z.object({
          path: z.string(),
          defaultValue: z.any().optional(),
          transform: z
            .literal("string")
            .or(z.literal("number"))
            .or(z.literal("boolean"))
            .or(z.any())
            .optional(),
        }),
      ),
    )
    .optional(),
  includeAttributes: z.array(z.string()).optional(),
  excludeAttributes: z.array(z.string()).optional(),
});

export const SyncOptionsSchema = z.object({
  delayMs: z.number().min(0).optional(),
  retries: z.number().min(0).optional(),
  retryDelayMs: z.number().min(0).optional(),
  batchSize: z.number().min(1).optional(),
  concurrency: z.number().min(1).optional(),
});

export const ConnectorConfigSchema = z.object({
  source: SourceAkeneoSchema,
  target: TargetVendureSchema.or(TargetMagentoSchema),
  mapping: MappingSchema,
  syncOptions: SyncOptionsSchema.optional(),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type TargetMagentoConfig = z.infer<typeof TargetMagentoSchema>["config"];

/**
 * Validates the configuration object against the schema.
 * Throws a detailed error if validation fails.
 */
export function validateConfig(config: any): ConnectorConfig {
  const result = ConnectorConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues
      .map((err: any) => {
        const path = err.path.join(".");
        return `${path}: ${err.message}`;
      })
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  return result.data;
}
