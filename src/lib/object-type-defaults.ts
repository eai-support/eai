import type { ObjectTypeDefinition, ObjectTypeProperty } from './config.js';

const STRING_DEFAULT_PROPERTY_TYPES = new Set(['text', 'date', 'file', 'relationship']);

function hasDefaultValue(property: ObjectTypeProperty): boolean {
  return Object.prototype.hasOwnProperty.call(property, 'defaultValue')
    && property.defaultValue !== undefined;
}

function describeValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (isFiniteNumber(value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

export function validateObjectTypePropertyDefaultValue(property: ObjectTypeProperty): string[] {
  if (!hasDefaultValue(property) || property.defaultValue === null) {
    return [];
  }

  const defaultValue = property.defaultValue;

  if (STRING_DEFAULT_PROPERTY_TYPES.has(property.type)) {
    return typeof defaultValue === 'string'
      ? []
      : [`property "${property.name}" defaultValue must be a string for ${property.type} properties; got ${describeValueType(defaultValue)}`];
  }

  if (property.type === 'select') {
    if (typeof defaultValue !== 'string') {
      return [`property "${property.name}" defaultValue must be a string for select properties; got ${describeValueType(defaultValue)}`];
    }

    const optionValues = property.options?.map((option) => option.value) ?? [];
    if (optionValues.length === 0) {
      return [`property "${property.name}" defaultValue cannot be validated because the select property has no options`];
    }

    return optionValues.includes(defaultValue)
      ? []
      : [`property "${property.name}" defaultValue "${defaultValue}" must match one of the select option values: ${optionValues.join(', ')}`];
  }

  if (property.type === 'number') {
    return isFiniteNumber(defaultValue)
      ? []
      : [`property "${property.name}" defaultValue must be a finite number; got ${describeValueType(defaultValue)}`];
  }

  if (property.type === 'boolean') {
    return typeof defaultValue === 'boolean'
      ? []
      : [`property "${property.name}" defaultValue must be a boolean; got ${describeValueType(defaultValue)}`];
  }

  if (property.type === 'json') {
    return isJsonValue(defaultValue)
      ? []
      : [`property "${property.name}" defaultValue must be JSON serializable; got ${describeValueType(defaultValue)}`];
  }

  return [];
}

export function validateObjectTypeDefaultValues(type: ObjectTypeDefinition): string[] {
  return type.properties.flatMap(validateObjectTypePropertyDefaultValue);
}
