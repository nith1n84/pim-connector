import { StorageProvider } from "../storage/storage.interface.js";

export interface SyncReport {
  id: string;
  startTime: string;
  endTime?: string;
  type: "product" | "category" | "schema";
  summary: {
    total: number;
    success: number;
    error: number;
  };
  details: Array<{
    identifier: string;
    status: "success" | "error";
    message?: string;
  }>;
}

/**
 * Service for collecting and generating synchronization reports.
 */
export class SyncReporter {
  private report: SyncReport;

  constructor(
    private readonly provider: StorageProvider,
    type: "product" | "category" | "schema",
  ) {
    this.report = {
      id: `run-${Date.now()}`,
      startTime: new Date().toISOString(),
      type,
      summary: { total: 0, success: 0, error: 0 },
      details: [],
    };
  }

  /**
   * Records a success for an entity.
   */
  logSuccess(identifier: string): void {
    this.report.summary.total++;
    this.report.summary.success++;
    this.report.details.push({ identifier, status: "success" });
  }

  /**
   * Records a failure for an entity.
   */
  logError(identifier: string, message: string): void {
    this.report.summary.total++;
    this.report.summary.error++;
    this.report.details.push({ identifier, status: "error", message });
  }

  /**
   * Finalizes and saves the report to storage.
   */
  async save(): Promise<string> {
    this.report.endTime = new Date().toISOString();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `.sync-data/reports/${this.report.type}-run-${timestamp}.json`;

    await this.provider.write(key, JSON.stringify(this.report, null, 2));
    return key;
  }

  getSummary() {
    return this.report.summary;
  }
}
