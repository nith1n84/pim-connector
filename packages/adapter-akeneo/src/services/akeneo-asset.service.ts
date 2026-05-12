import { Logger } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";

/**
 * Service for handling Akeneo assets.
 */
export class AkeneoAssetService {
  constructor(
    private client: AkeneoClient,
    private logger: Logger,
  ) {}

  async getProductMediaFile(productUuid: string) {
    try {
      const media = await this.client.request<any>({
        url: `/api/rest/v1/media-files/${productUuid}`,
        method: "GET",
      });
      return media;
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
          filename: fileInfo.original_filename, // Default extension, could be improved
          mimeType: fileInfo.mime_type, // Default MIME type
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

  /**
   * Downloads product media file and converts to base64 data URL for assetFiles
   */
  async downloadProductMediaFileAsBase64(code: string): Promise<string | null> {
    const result = await this.downloadProductMediaFile(code);
    if (!result) {
      return null;
    }

    const { buffer, mimeType } = result;
    const base64 = buffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  }
}
