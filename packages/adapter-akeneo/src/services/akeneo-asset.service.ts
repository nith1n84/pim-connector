import { Logger } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";
import axios from "axios";

/**
 * Service for handling Akeneo asset retrieval and downloading.
 * Manages both product-level media files and asset-collection assets.
 */
export class AkeneoAssetService {
  constructor(
    private readonly client: AkeneoClient,
    private readonly logger: Logger,
  ) {}

  async getProductMediaFile(productUuid: string) {
    try {
      return await this.client.request<any>({
        url: `/api/rest/v1/media-files/${productUuid}`,
        method: "GET",
      });
    } catch (error) {
      return null;
    }
  }

  async downloadProductMediaFile(code: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    code: string;
  } | null> {
    const fileInfo = await this.getProductMediaFile(code);

    try {
      const response = await this.client.request<any>({
        url: `/api/rest/v1/media-files/${code}/download`,
        method: "GET",
        responseType: "arraybuffer",
      });

      // If response is already a buffer (from axios with responseType: 'arraybuffer')
      if (Buffer.isBuffer(response)) {
        return {
          code: code,
          buffer: response,
          filename: fileInfo.original_filename,
          mimeType: fileInfo.mime_type,
        };
      }

      // Handle different response formats
      let buffer: Buffer;
      let mimeType = "image/jpeg";
      let filename = `${code}.jpg`;

      if (response.data) {
        buffer = Buffer.from(response.data);
      } else if (typeof response === "object" && response.buffer) {
        buffer = Buffer.from(response.buffer);
        mimeType = response.mimeType || mimeType;
        filename = response.filename || filename;
      } else {
        buffer = Buffer.from(response);
      }

      return {
        code,
        buffer,
        filename,
        mimeType,
      };
    } catch (e) {
      this.logger.error(`Failed to download media file ${code}:`, e);
      return null;
    }
  }

  async downloadAssetMediaFile(assetFamilyCode: string, assetCodes: string[]): Promise<any[]> {
    const assets = [];

    const assetFamily = await this.client.getAssetFamily(assetFamilyCode);
    if (!assetFamily) {
      this.logger.warn(`Asset family ${assetFamilyCode} not found in Akeneo`);
      return [];
    }

    const assetInfo = await this.client.getAssetsFromAssetFamily(assetFamilyCode, assetCodes);

    if (assetInfo.length === 0) return [];

    for (const asset of assetInfo) {
      const mainAsset = asset?.values?.[assetFamily.attribute_as_main_media]?.[0];
      if (!mainAsset) continue;

      const mainAssetCode = mainAsset.data;
      const mainAssetData = mainAsset?.linked_data;

      try {
        if (mainAssetData?.full_url) {
          const response = await axios.get<ArrayBuffer>(mainAssetData?.full_url, {
            responseType: "arraybuffer",
          });
          const buffer = Buffer.from(response.data);
          const mimeType = response.headers["content-type"] || "application/octet-stream";

          assets.push({
            code: mainAssetCode,
            buffer,
            filename: mainAssetCode.trim().split("/").pop() || "asset",
            mimeType,
          });
        } else {
          const response = await this.client.request<any>({
            url: `/api/rest/v1/asset-media-files/${mainAssetCode}`,
            method: "GET",
            responseType: "arraybuffer",
          });

          if (Buffer.isBuffer(response)) {
            assets.push({
              code: mainAssetCode,
              buffer: response,
              filename: mainAssetData.original_filename,
              mimeType: mainAssetData.mime_type,
            });
          }
        }
      } catch (e) {
        this.logger.error(`Failed to download media file ${asset.code}:`, e);
      }
    }

    return assets;
  }
}
