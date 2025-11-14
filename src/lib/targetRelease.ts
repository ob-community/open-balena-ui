export type TargetReleaseOrigin = 'device' | 'fleet' | 'latest';

export interface TargetReleaseInfo {
  targetReleaseId?: string | number;
  origin: TargetReleaseOrigin;
}

export const getTargetOriginLabel = (origin: TargetReleaseOrigin): string => {
  switch (origin) {
    case 'device':
      return 'Device Pin';
    case 'fleet':
      return 'Fleet Pin';
    default:
      return 'Track Latest';
  }
};

type EntityRecord = Record<string, any> | null | undefined;

const hasValue = (value: unknown): value is string | number => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'number') {
    return !Number.isNaN(value);
  }

  return false;
};

const getFieldValue = (record: EntityRecord, field: string) => (record ? record[field] : undefined);

const getPinnedValue = (record: EntityRecord, pinField: string) => {
  const candidate = getFieldValue(record, pinField);
  return hasValue(candidate) ? candidate : undefined;
};

const getTargetValue = (record: EntityRecord, pinField: string) => {
  const pinned = getPinnedValue(record, pinField);
  if (pinned !== undefined) {
    return pinned;
  }

  const fallback = getFieldValue(record, 'should be running-release');
  return hasValue(fallback) ? fallback : undefined;
};

export const resolveDeviceTargetRelease = ({
  record,
  fleetRecord,
  pinField,
}: {
  record: EntityRecord;
  fleetRecord?: EntityRecord;
  pinField: string;
}): TargetReleaseInfo => {
  if (!record) {
    return { origin: 'latest', targetReleaseId: undefined };
  }

  const devicePin = getPinnedValue(record, pinField);
  if (devicePin !== undefined) {
    return { origin: 'device', targetReleaseId: devicePin };
  }

  if (fleetRecord) {
    const fleetInfo = resolveFleetTargetRelease({ record: fleetRecord, pinField });
    if (fleetInfo.targetReleaseId !== undefined || fleetInfo.origin !== 'latest') {
      return fleetInfo;
    }
  }

  const recordTarget = getTargetValue(record, pinField);
  if (recordTarget !== undefined) {
    return { origin: 'fleet', targetReleaseId: recordTarget };
  }

  return { origin: 'latest', targetReleaseId: undefined };
};

export const resolveFleetTargetRelease = ({
  record,
  pinField,
}: {
  record: EntityRecord;
  pinField: string;
}): TargetReleaseInfo => {
  if (!record) {
    return { origin: 'latest', targetReleaseId: undefined };
  }

  const isTrackingLatest = Boolean(getFieldValue(record, 'should track latest release'));

  const pinnedTarget = getPinnedValue(record, pinField);
  if (pinnedTarget !== undefined) {
    return { origin: 'fleet', targetReleaseId: pinnedTarget };
  }

  const fallbackTarget = getTargetValue(record, pinField);
  if (fallbackTarget !== undefined) {
    return {
      origin: isTrackingLatest ? 'latest' : 'fleet',
      targetReleaseId: fallbackTarget,
    };
  }

  return { origin: 'latest', targetReleaseId: undefined };
};
