import { AttributeDefinition } from "@pim-connector/core";

/**
 * Maps Akeneo attribute types to CDM (Canonical Data Model) types.
 *
 * @param akeneoType - The internal Akeneo attribute type code
 * @returns The equivalent CDM attribute type
 */
export function mapAkeneoTypeToCdmType(akeneoType: string): AttributeDefinition["cdmType"] {
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

/**
 * Formats a Date object into the Akeneo API compatible string format (YYYY-MM-DD HH:mm:ss).
 *
 * @param date - The date object to format
 * @returns A string representation of the date for Akeneo filters
 */
export function formatAkeneoDate(date: Date): string {
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
