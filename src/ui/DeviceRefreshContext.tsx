import React from 'react';
import { Alert } from '@mui/material';
import { useGetList, useGetMany, useGetOne } from 'react-admin';
import { useQueryClient } from '@tanstack/react-query';
import type { ResourceRecord } from '../types/resource';
import { getDeviceRefreshInterval, settleDeviceActions, steadyDeviceRefreshMs } from '../lib/deviceRefresh';
import { relationshipId } from '../lib/deviceServicePresentation';
import { resolveDeviceTargetRelease } from '../lib/targetRelease';
import environment from '../lib/reactAppEnv';
import versions from '../versions';
import { useDeviceRefreshActions } from './useDeviceRefreshActions';

interface DeviceRefreshState {
  deviceId: string;
  interval: number;
  installs: ResourceRecord[];
}
export const DeviceRefreshContext = React.createContext<DeviceRefreshState | undefined>(undefined);
const pinField = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

export const DeviceRefreshProvider: React.FC<React.PropsWithChildren<{ deviceId: string }>> = ({
  deviceId,
  children,
}) => {
  const client = useQueryClient();
  const [interval, setInterval] = React.useState(() =>
    getDeviceRefreshInterval(
      client.getQueryData<ResourceRecord>(['device', 'getOne', { id: deviceId, meta: undefined }]),
    ),
  );
  const { actions, settle } = useDeviceRefreshActions();
  const deviceQuery = useGetOne<ResourceRecord>(
    'device',
    { id: deviceId },
    {
      refetchInterval: interval,
      refetchIntervalInBackground: false,
    },
  );
  const device = deviceQuery.data;
  const installs = useGetList<ResourceRecord>(
    'image install',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { device: device?.id },
    },
    { enabled: device != null, refetchInterval: interval, refetchIntervalInBackground: false },
  );
  const appId = relationshipId(device?.['belongs to-application']);
  const fleet = useGetOne<ResourceRecord>(
    'application',
    { id: appId ?? 0 },
    {
      enabled: appId != null,
      refetchInterval: steadyDeviceRefreshMs,
      refetchIntervalInBackground: false,
    },
  );
  const appTarget = resolveDeviceTargetRelease({ record: device, fleetRecord: fleet.data, pinField }).targetReleaseId;
  const latest = useGetList<ResourceRecord>(
    'release',
    {
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'id', order: 'DESC' },
      filter: { 'belongs to-application': appId, 'status': 'success' },
    },
    {
      enabled: appId != null && appTarget == null && !fleet.isPending,
      refetchInterval: steadyDeviceRefreshMs,
      refetchIntervalInBackground: false,
    },
  );
  const hostId = relationshipId(device?.['should be operated by-release']);
  const supervisorId = relationshipId(device?.['should be managed by-release']);
  const releaseIds = [...new Set([hostId, supervisorId].filter((id) => id != null))];
  const releases = useGetMany<ResourceRecord>(
    'release',
    { ids: releaseIds },
    {
      enabled: releaseIds.length > 0,
      staleTime: Infinity,
    },
  );
  const targetVersion = (id: number | string | undefined): string | undefined => {
    const release = releases.data?.find((entry) => String(entry.id) === String(id));
    const value = release?.['raw version'] ?? release?.raw_version;
    return typeof value === 'string' ? value : undefined;
  };
  const targets = {
    hostVersion: targetVersion(hostId),
    supervisorVersion: targetVersion(supervisorId),
    appReleaseId: appTarget ?? latest.data?.[0]?.id,
  };
  const pending = actions[deviceId] ?? [];
  const next = getDeviceRefreshInterval(device, installs.data, pending, targets);
  React.useEffect(() => setInterval(next), [next]);
  React.useEffect(() => {
    const remaining = settleDeviceActions(
      pending,
      device,
      installs.data ?? [],
      {
        device: deviceQuery.dataUpdatedAt,
        installs: installs.dataUpdatedAt,
      },
      targets,
    );
    settle(deviceId, remaining);
  }, [
    pending,
    device,
    installs.data,
    deviceQuery.dataUpdatedAt,
    installs.dataUpdatedAt,
    deviceId,
    settle,
    targets.hostVersion,
    targets.supervisorVersion,
    targets.appReleaseId,
  ]);
  const error = installs.error ?? releases.error ?? fleet.error ?? latest.error;
  const value = React.useMemo(
    () => ({
      deviceId,
      interval,
      installs: installs.data ?? [],
    }),
    [deviceId, interval, installs.data],
  );
  return (
    <DeviceRefreshContext.Provider value={value}>
      {error && <Alert severity='error'>Unable to refresh device state: {error.message}</Alert>}
      {children}
    </DeviceRefreshContext.Provider>
  );
};
