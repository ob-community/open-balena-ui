import type { RaRecord } from 'react-admin';

export type ResourceRecord = RaRecord & Record<string, unknown>;

export const getStringField = (record: ResourceRecord, field: string): string | undefined => {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
};

export const getNumberField = (record: ResourceRecord, field: string): number | undefined => {
  const value = record[field];
  return typeof value === 'number' ? value : undefined;
};

export const getBooleanField = (record: ResourceRecord, field: string): boolean | undefined => {
  const value = record[field];
  return typeof value === 'boolean' ? value : undefined;
};
