import semver from 'semver';
import type { ResourceRecord } from '../types/resource';
import type { RemoteTarget } from './builtInRemoteAccess';
import { isContainerName } from './remoteTarget';
import { getProgressPercentage } from './deviceUpdateProgress';

export const deviceLogServiceEvent = 'open-balena-ui:select-device-log-service';

export interface DeviceLogServiceSelection {
  serviceId: number;
  serviceName: string;
  logSource?: 'service' | 'supervisor';
  deviceId?: number | string;
  serviceGroup?: 'app' | 'supervisor';
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

export interface PresentedDeviceService extends ResourceRecord {
  serviceName: string;
  serviceId?: number | string;
  serviceGroup?: 'app' | 'supervisor';
  targetInstall?: PresentedDeviceService;
}

export const getServiceDownloadProgress = (install: ResourceRecord): number | undefined =>
  getProgressPercentage(install['download progress']);

export const deviceServiceLogSource = (
  service: Pick<PresentedDeviceService, 'serviceName' | 'serviceGroup'>,
): 'service' | 'supervisor' =>
  service.serviceGroup === 'supervisor' && service.serviceName === 'core' ? 'supervisor' : 'service';

export const matchesDeviceServiceLog = (
  entry: { serviceId?: number | string | null },
  selection: Pick<DeviceLogServiceSelection, 'serviceId' | 'logSource'>,
): boolean => {
  const isDefaultLog = entry.serviceId == null;
  if (selection.serviceId === 0) return isDefaultLog;
  // Canonical Supervisor core logs use the default stream, not its cloud service ID.
  return (
    (selection.logSource === 'supervisor' && isDefaultLog) ||
    (!isDefaultLog && Number(entry.serviceId) === selection.serviceId)
  );
};

const compareIds = (left: number | string, right: number | string): number =>
  String(left).localeCompare(String(right), 'en', { numeric: true });

export const orderDeviceServices = <T extends { serviceName: string; id: number | string }>(services: T[]): T[] =>
  [...services].sort(
    (left, right) =>
      left.serviceName.localeCompare(right.serviceName, 'en', { sensitivity: 'base', numeric: true }) ||
      left.serviceName.localeCompare(right.serviceName, 'en') ||
      compareIds(left.id, right.id),
  );

const pairServiceInstalls = (
  currentServices: PresentedDeviceService[],
  incomingServices: PresentedDeviceService[],
): PresentedDeviceService[] => {
  const paired = new Set<PresentedDeviceService>();
  return orderDeviceServices([
    ...currentServices.map((current) => {
      const incoming = incomingServices.find(
        (candidate) =>
          current.serviceId !== undefined &&
          candidate.serviceId !== undefined &&
          String(candidate.serviceId) === String(current.serviceId),
      );
      if (!incoming) return current;
      paired.add(incoming);
      return { ...current, targetInstall: incoming };
    }),
    ...incomingServices.filter((incoming) => !paired.has(incoming)),
  ]);
};

const normalizedVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return semver.parse(value)?.version ?? semver.coerce(value)?.version;
};

export const presentDeviceServices = ({
  installs,
  images,
  services,
  appReleaseId,
  targetAppReleaseId,
  supervisorReleaseId,
  supervisorVersion,
  releases = [],
  showSupervisorServices,
}: {
  installs: ResourceRecord[];
  images: ResourceRecord[];
  services: ResourceRecord[];
  appReleaseId?: number | string;
  targetAppReleaseId?: number | string;
  supervisorReleaseId?: number | string;
  supervisorVersion?: unknown;
  releases?: ResourceRecord[];
  showSupervisorServices: boolean;
}) => {
  const imageById = new Map(images.map((image) => [String(image.id), image]));
  const serviceById = new Map(services.map((service) => [String(service.id), service]));
  const resolved: PresentedDeviceService[] = installs.map((install) => {
    const imageId = relationshipId(install['installs-image']);
    const serviceId = relationshipId(imageById.get(String(imageId))?.['is a build of-service']);
    const name = serviceById.get(String(serviceId))?.['service name'];
    return {
      ...install,
      serviceId,
      serviceName: typeof name === 'string' && name ? name : 'Unknown service',
    };
  });
  const forRelease = (
    releaseId: number | string | undefined,
    serviceGroup: 'app' | 'supervisor',
  ): PresentedDeviceService[] =>
    releaseId === undefined
      ? []
      : orderDeviceServices(
          resolved
            .filter((install) => String(relationshipId(install['is provided by-release'])) === String(releaseId))
            .map((install) => ({ ...install, serviceGroup })),
        );
  const currentServices = forRelease(appReleaseId, 'app');
  const incomingServices =
    targetAppReleaseId !== undefined && String(targetAppReleaseId) !== String(appReleaseId)
      ? forRelease(targetAppReleaseId, 'app')
      : [];
  const appServices = pairServiceInstalls(currentServices, incomingServices);
  const targetSupervisor = releases.find((release) => String(release.id) === String(supervisorReleaseId));
  const supervisorAppId = relationshipId(targetSupervisor?.['belongs to-application']);
  const reportedVersion = normalizedVersion(supervisorVersion);
  const currentSupervisor = reportedVersion
    ? releases.find(
        (release) =>
          supervisorAppId !== undefined &&
          String(relationshipId(release['belongs to-application'])) === String(supervisorAppId) &&
          normalizedVersion(release['raw version'] ?? release.raw_version) === reportedVersion,
      )
    : undefined;
  const currentSupervisorReleaseId = currentSupervisor?.id;
  const supervisorServices = !showSupervisorServices
    ? []
    : currentSupervisorReleaseId === undefined || String(currentSupervisorReleaseId) === String(supervisorReleaseId)
      ? forRelease(supervisorReleaseId, 'supervisor')
      : pairServiceInstalls(
          forRelease(currentSupervisorReleaseId, 'supervisor'),
          forRelease(supervisorReleaseId, 'supervisor'),
        );
  return { appServices, supervisorServices, services: [...appServices, ...supervisorServices] };
};

export const getServiceColors = (name: string) => {
  let hash = 2166136261;
  for (const character of name) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const hue = name === 'Host OS' ? 210 : hash % 360;
  const saturation = name === 'Host OS' ? 18 : 58 + ((hash >>> 9) % 27);
  const lightness = name === 'Host OS' ? 82 : 74 + ((hash >>> 18) % 14);
  return {
    backgroundColor: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    color: '#15202b',
    borderColor: `hsl(${hue}, 55%, 48%)`,
  };
};

export const deviceServiceTerminalTargets = (services: PresentedDeviceService[]): RemoteTarget[] => {
  const targetIds = new Set<string>();
  return [
    { id: 'host', label: 'Host OS', target: 'host' as const },
    ...services.flatMap((service) => {
      const name = service.serviceName;
      const id = `container:${service.serviceGroup === 'supervisor' ? 'supervisor:' : ''}${name}`;
      if (
        service.status !== 'Running' ||
        service.serviceId === undefined ||
        !isContainerName(name) ||
        targetIds.has(id)
      )
        return [];
      targetIds.add(id);
      const container = service.serviceGroup === 'supervisor' && name === 'core' ? 'balena_supervisor' : name;
      const containerKind =
        service.serviceGroup === 'supervisor' && name === 'core' ? ('supervisor' as const) : ('service' as const);
      return [{ id, label: name, target: 'container' as const, container, containerKind }];
    }),
  ];
};
