import { useGetList, useGetMany, useGetOne } from 'react-admin';
import { hasSupervisorServiceTable, presentDeviceServices, relationshipId } from '../lib/deviceServicePresentation';
import type { ResourceRecord } from '../types/resource';

const relationshipIds = (records: ResourceRecord[], field: string) => [
  ...new Set(records.map((record) => relationshipId(record[field])).filter((id) => id !== undefined)),
];

export const useDeviceServicePresentation = (device?: ResourceRecord) => {
  const installs = useGetList<ResourceRecord>(
    'image install',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { device: device?.id },
    },
    { enabled: device !== undefined },
  );
  const imageIds = relationshipIds(installs.data ?? [], 'installs-image');
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
      installs: installs.data ?? [],
      images: images.data ?? [],
      services: services.data ?? [],
      appReleaseId: relationshipId(device?.['is running-release']),
      supervisorReleaseId,
      showSupervisorServices,
    }),
    showSupervisorServices,
    isPending:
      (device !== undefined && installs.isPending) ||
      (imageIds.length > 0 && images.isPending) ||
      (serviceIds.length > 0 && services.isPending) ||
      (supervisorReleaseId !== undefined && release.isPending),
    error: installs.error ?? images.error ?? services.error ?? release.error,
  };
};
