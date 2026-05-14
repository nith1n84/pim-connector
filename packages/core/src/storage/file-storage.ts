import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { StorageProvider } from "./storage.interface.js";

/**
 * File-based implementation of StorageProvider.
 */
export class FileStorageProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private getPath(key: string): string {
    return join(this.baseDir, key);
  }

  async read(key: string): Promise<string | null> {
    try {
      return await readFile(this.getPath(key), "utf-8");
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(key: string, data: string): Promise<void> {
    const filePath = this.getPath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data, "utf-8");
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.getPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.getPath(key));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
