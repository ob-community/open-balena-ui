import semver from 'semver';

export const deviceLogServiceEvent = 'open-balena-ui:select-device-log-service';

export interface DeviceLogServiceSelection {
  serviceId: number;
  serviceName: string;
}

export const relationshipId = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return relationshipId(value[0]);
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  const id = record.id ?? record.__id;
  return typeof id === 'number' || typeof id === 'string' ? id : undefined;
};

export const hasSupervisorServiceTable = (version: unknown): boolean => {
  if (typeof version !== 'string') return false;
  const parsed = semver.parse(version) ?? semver.coerce(version);
  return parsed != null && semver.gte(parsed, '18.2.0');
};

export const queuedOsUpdateMode = (supervisorVersion: unknown): 'supervisor' | 'cloudlink' | 'unknown' => {
  if (typeof supervisorVersion !== 'string') return 'unknown';
  const parsed = semver.parse(supervisorVersion) ?? semver.coerce(supervisorVersion);
  if (!parsed) return 'unknown';
  return semver.gte(parsed, '19.0.0') ? 'supervisor' : 'cloudlink';
};

export const selectDeviceLogService = (selection: DeviceLogServiceSelection): void => {
  window.dispatchEvent(new CustomEvent<DeviceLogServiceSelection>(deviceLogServiceEvent, { detail: selection }));
};
