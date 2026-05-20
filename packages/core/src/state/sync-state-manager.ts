import { StorageProvider } from "../storage/storage.interface.js";

export interface SyncState {
  lastRunStartTime?: string;
  lastSuccessfulRun?: string;
  status?: "IDLE" | "RUNNING";
}

/**
 * Service for managing synchronization state (e.g., last run time, job locks).
 */
export class SyncStateManager {
  private readonly stateKey = "sync-state.json";

  constructor(private readonly provider: StorageProvider) {}

  /**
   * Retrieves the last synchronization state.
   */
  async getState(): Promise<SyncState | null> {
    const data = await this.provider.read(this.stateKey);
    if (!data) return null;
    return JSON.parse(data);
  }

  /**
   * Updates the synchronization state.
   */
  async updateState(state: Partial<SyncState>): Promise<void> {
    const currentState = (await this.getState()) || {};
    const newState = { ...currentState, ...state };
    await this.provider.write(this.stateKey, JSON.stringify(newState, null, 2));
  }

  /**
   * Attempts to acquire a lock for the synchronization job.
   * Throws an error if a job is already running.
   */
  async acquireLock(): Promise<void> {
    const state = await this.getState();
    if (state?.status === "RUNNING") {
      throw new Error(
        "A synchronization job is already running. Please wait for it to complete or manually reset the status in sync-state.json.",
      );
    }
    await this.updateState({ status: "RUNNING" });
  }

  /**
   * Releases the lock for the synchronization job.
   */
  async releaseLock(): Promise<void> {
    await this.updateState({ status: "IDLE" });
  }

  /**
   * Convenience method to get the last run date as a Date object.
   */
  async getLastRunDate(): Promise<Date | null> {
    const state = await this.getState();
    return state?.lastRunStartTime ? new Date(state.lastRunStartTime) : null;
  }
}
