export type TransformFunc = (value: any) => any;

export interface FieldMapping {
  path: string;
  defaultValue?: any;
  transform?: TransformFunc | 'string' | 'number' | 'boolean';
}

export interface MappingConfig {
  [key: string]: string | FieldMapping;
}

export class TransformationEngine {
  /**
   * Transforms a source object into a target object based on the mapping configuration.
   */
  transform<T = any>(source: any, mapping: MappingConfig): T {
    const result: any = {};

    for (const [targetKey, config] of Object.entries(mapping)) {
      const fieldConfig: FieldMapping = typeof config === 'string' ? { path: config } : config;
      
      let value = this.getNestedValue(source, fieldConfig.path);

      // Apply default value if missing
      if (value === undefined || value === null) {
        value = fieldConfig.defaultValue;
      }

      // Apply transformation if specified
      if (value !== undefined && fieldConfig.transform) {
        value = this.applyTransform(value, fieldConfig.transform);
      }

      result[targetKey] = value;
    }

    return result as T;
  }

  /**
   * Helper to get a value from a nested object using dot notation (e.g., "user.profile.name")
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    
    return path.split('.').reduce((acc, part) => {
      return acc && typeof acc === 'object' ? acc[part] : undefined;
    }, obj);
  }

  /**
   * Applies the specified transformation to a value.
   */
  private applyTransform(value: any, transform: FieldMapping['transform']): any {
    if (typeof transform === 'function') {
      return transform(value);
    }

    switch (transform) {
      case 'string':
        return String(value);
      case 'number':
        const num = Number(value);
        return isNaN(num) ? undefined : num;
      case 'boolean':
        return Boolean(value);
      default:
        return value;
    }
  }
}

/**
 * Convenience function for one-off transformations
 */
export function transformData<T = any>(source: any, mapping: MappingConfig): T {
  const engine = new TransformationEngine();
  return engine.transform<T>(source, mapping);
}
