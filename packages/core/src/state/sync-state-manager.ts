import { StorageProvider } from "../storage/storage.interface.js";

export interface SyncState {
  lastRunStartTime?: string;
  lastSuccessfulRun?: string;
}

/**
 * Service for managing synchronization state (e.g., last run time).
 */
export class SyncStateManager {
  private readonly stateKey = ".sync-data/sync-state.json";

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
   * Convenience method to get the last run date as a Date object.
   */
  async getLastRunDate(): Promise<Date | null> {
    const state = await this.getState();
    return state?.lastRunStartTime ? new Date(state.lastRunStartTime) : null;
  }
}
