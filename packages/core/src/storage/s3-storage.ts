import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { StorageProvider } from "./storage.interface.js";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  prefix?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix || "";

    const clientConfig: any = {
      region: config.region,
    };

    if (config.credentials) {
      clientConfig.credentials = {
        accessKeyId: config.credentials.accessKeyId,
        secretAccessKey: config.credentials.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async read(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.getKey(key),
      });
      const response = await this.client.send(command);

      if (!response.Body) {
        return null;
      }
      return await response.Body.transformToString();
    } catch (error: any) {
      if (error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async write(key: string, data: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(key),
      Body: data,
    });
    await this.client.send(command);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.getKey(key),
      });
      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(key),
    });
    await this.client.send(command);
  }
}
