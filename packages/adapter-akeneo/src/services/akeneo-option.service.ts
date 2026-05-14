import { Logger, OptionGroup } from "@pim-connector/core";
import { AkeneoClient } from "../client/akeneo.client.js";
import { AkeneoMapper } from "../mappers/akeneo.mapper.js";

/**
 * Service for managing Akeneo attribute options and option groups.
 * Handles fetching select-type attributes and their localized labels.
 */
export class AkeneoOptionService {
  constructor(
    private readonly client: AkeneoClient,
    private readonly mapper: AkeneoMapper,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolves option groups for the specified attribute codes (axes).
   * Utilizes local mapping cache to avoid redundant API calls.
   * @param axes - The attribute codes to resolve as option groups.
   * @returns Array of CDM-formatted option groups.
   */
  async resolveOptionGroups(axes: string[]): Promise<OptionGroup[]> {
    const existingOptionGroups = this.mapper.getOptionGroups();
    const existingMap = new Map(existingOptionGroups.map((group) => [group.code, group]));

    const existing = axes
      .map((axis) => existingMap.get(axis))
      .filter((group): group is OptionGroup => !!group);

    const missingAxes = axes.filter((axis) => !existingMap.has(axis));

    if (missingAxes.length === 0) {
      return existing;
    }

    this.logger.debug(`Fetching missing option groups from Akeneo: ${missingAxes.join(", ")}`);
    const fetchedOptionGroups = await this.client.getOptionGroups(missingAxes);

    // Update mapper cache
    this.mapper.setOptionGroups([...existingOptionGroups, ...fetchedOptionGroups]);

    return [...existing, ...fetchedOptionGroups];
  }
}
