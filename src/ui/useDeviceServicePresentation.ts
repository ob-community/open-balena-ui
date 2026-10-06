import { useGetList, useGetMany, useGetOne } from 'react-admin';
import { hasSupervisorServiceTable, presentDeviceServices, relationshipId } from '../lib/deviceServicePresentation';
import type { ResourceRecord } from '../types/resource';
import React from 'react';
import { DeviceRefreshContext } from './DeviceRefreshContext';
import { useDeviceRefreshActions } from './useDeviceRefreshActions';
import { getDeviceRefreshInterval } from '../lib/deviceRefresh';

const relationshipIds = (records: ResourceRecord[], field: string) => [
  ...new Set(records.map((record) => relationshipId(record[field])).filter((id) => id !== undefined)),
];

export const useDeviceServicePresentation = (device?: ResourceRecord) => {
  const refresh = React.useContext(DeviceRefreshContext);
  const managed = refresh?.deviceId === String(device?.id);
  const { actions } = useDeviceRefreshActions();
  const installs = useGetList<ResourceRecord>(
    'image install',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { device: device?.id },
    },
    {
      enabled: device !== undefined && !managed,
      refetchInterval: managed
        ? false
        : (query) => getDeviceRefreshInterval(device, query.state.data?.data, actions[String(device?.id)] ?? []),
      refetchIntervalInBackground: false,
      staleTime: 30_000,
    },
  );
  const installsIsPending = managed ? refresh.installsIsPending : installs.isPending;
  const installsError = managed ? refresh.installsError : installs.error;
  const installSnapshot = managed ? refresh.installs : installs.data;
  const installRecords = !installsIsPending && !installsError ? (installSnapshot ?? []) : [];
  const imageIds = relationshipIds(installRecords, 'installs-image');
  const images = useGetMany<ResourceRecord>('image', { ids: imageIds }, { enabled: imageIds.length > 0 });
  const serviceIds = relationshipIds(images.data ?? [], 'is a build of-service');
  const services = useGetMany<ResourceRecord>('service', { ids: serviceIds }, { enabled: serviceIds.length > 0 });
  const supervisorReleaseId = relationshipId(device?.['should be managed by-release']);
  const release = useGetOne<ResourceRecord>(
    'release',
    { id: supervisorReleaseId ?? 0 },
    { enabled: supervisorReleaseId !== undefined },
  );
  const showSupervisorServices =
    supervisorReleaseId !== undefined &&
    hasSupervisorServiceTable(release.data?.['raw version'] ?? release.data?.raw_version);
  return {
    ...presentDeviceServices({
      installs: installRecords,
      images: images.data ?? [],
      services: services.data ?? [],
      appReleaseId: relationshipId(device?.['is running-release']),
      supervisorReleaseId,
      showSupervisorServices,
    }),
    showSupervisorServices,
    isPending:
      (device !== undefined && installsIsPending) ||
      (imageIds.length > 0 && images.isPending) ||
      (serviceIds.length > 0 && services.isPending) ||
      (supervisorReleaseId !== undefined && release.isPending),
    error:
      installsError ??
      (imageIds.length > 0 ? images.error : undefined) ??
      (serviceIds.length > 0 ? services.error : undefined) ??
      (supervisorReleaseId !== undefined ? release.error : undefined) ??
      null,
  };
};
