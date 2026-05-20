import { Asset, IdentityMap, Logger } from "@pim-connector/core";
import { MagentoClient } from "../client/magento.client.js";

/**
 * Service for uploading and tracking product media in Magento.
 *
 * Strategy:
 *  - Checks assetIdentityMap before uploading to avoid duplicates.
 *  - Converts asset buffers to base64 for the Magento media gallery API.
 *  - The first uploaded image is set as the base image (thumbnail + small).
 */
export class MagentoMediaService {
  constructor(
    private readonly client: MagentoClient,
    private readonly assetIdentityMap: IdentityMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Synchronises a product's media assets to Magento.
   * Returns the list of uploaded/existing Magento media entry IDs.
   *
   * @param sku - The product SKU to attach media to.
   * @param assets - CDM Asset list from the product.
   */
  async syncMedia(sku: string, assets: Asset[]): Promise<number[]> {
    if (!assets || assets.length === 0) return [];

    const uploadedIds: number[] = [];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      if (!asset?.id) continue;

      // 1. Check identity map — skip if already uploaded
      const existingId = this.assetIdentityMap.getTargetId(asset.id);
      if (existingId) {
        this.logger.debug(`Asset ${asset.id} already uploaded (Magento ID: ${existingId})`);
        uploadedIds.push(Number(existingId));
        continue;
      }

      // 2. We need a buffer to upload
      if (!asset.buffer) {
        this.logger.debug(`Asset ${asset.id} has no buffer — skipping media upload.`);
        continue;
      }

      // 3. Upload
      try {
        const mediaId = await this.uploadAsset(sku, asset, i === 0);
        this.assetIdentityMap.setMapping(asset.id, String(mediaId));
        uploadedIds.push(mediaId);
        this.logger.debug(`Uploaded asset ${asset.id} → Magento media ID ${mediaId}`);
      } catch (error) {
        this.logger.error(`Failed to upload asset ${asset.id} for SKU ${sku}:`, error);
      }
    }

    return uploadedIds;
  }

  /**
   * Uploads a single asset as a Magento media gallery entry.
   * @param sku - Product SKU.
   * @param asset - CDM Asset (must have `buffer`).
   * @param isPrimary - If true, sets the image as base/small/thumbnail types.
   * @returns The Magento media entry ID.
   */
  private async uploadAsset(sku: string, asset: Asset, isPrimary: boolean): Promise<number> {
    if (!asset.buffer) throw new Error(`Asset ${asset.id} has no buffer`);

    const base64Data = asset.buffer.toString("base64");
    const filename = asset.name || `${asset.id}.jpg`;
    const mimeType = asset.mimeType || "image/jpeg";

    const types = isPrimary ? ["image", "small_image", "thumbnail", "swatch_image"] : [];

    const payload = {
      entry: {
        media_type: "image",
        label: asset.altText || filename,
        position: 0,
        disabled: false,
        types,
        content: {
          base64_encoded_data: base64Data,
          type: mimeType,
          name: filename,
        },
      },
    };

    const encodedSku = encodeURIComponent(sku);
    const mediaId = await this.client.post<number>(`/V1/products/${encodedSku}/media`, payload);
    return mediaId;
  }
}
