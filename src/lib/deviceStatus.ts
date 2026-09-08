import environment from './reactAppEnv';
import versions from '../versions';

type DeviceStatusRecord = Record<string, unknown> | null | undefined;

const normalizeStatus = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export const deviceOnlineStatusField = versions.field(
  'deviceOnlineStatus',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);

export const usesVpnOnlineStatus = deviceOnlineStatusField === 'is connected to vpn';

export const isDeviceOnline = (device: DeviceStatusRecord): boolean => {
  if (!device) {
    return false;
  }

  const status = device[deviceOnlineStatusField];
  return usesVpnOnlineStatus ? status === true || status === 'true' : normalizeStatus(status) === 'online';
};

export const getDeviceOnlineFilterValue = (online: boolean): boolean | 'online' | 'offline' =>
  usesVpnOnlineStatus ? online : online ? 'online' : 'offline';

export const parseDeviceOnlineFilterValue = (value: unknown): boolean | undefined => {
  if (usesVpnOnlineStatus) {
    if (value === true || value === 'true') {
      return true;
    }
    if (value === false || value === 'false') {
      return false;
    }
    return undefined;
  }

  const status = normalizeStatus(value);
  return status === 'online' ? true : status === 'offline' ? false : undefined;
};

export const getDeviceStatusTimestamp = (device: DeviceStatusRecord): unknown => {
  if (!device) {
    return undefined;
  }

  if (!isDeviceOnline(device)) {
    return device['last connectivity event'];
  }

  return usesVpnOnlineStatus ? device['last vpn event'] : device['changed api heartbeat state on-date'];
};

const activeDeviceStatuses = new Set([
  'downloading',
  'downloaded',
  'installing',
  'installed',
  'starting',
  'stopping',
  'configuring',
]);

const activeUpdateStatuses = new Set(['downloading', 'downloaded', 'applying changes']);
const failedUpdateStatuses = new Set(['aborted', 'rejected']);

export const isDeviceUpdating = (device: DeviceStatusRecord, imageInstalls: DeviceStatusRecord[] = []): boolean => {
  if (!device) {
    return false;
  }

  if (activeUpdateStatuses.has(normalizeStatus(device['update status']))) {
    return true;
  }

  const deviceStatus = normalizeStatus(device.status);
  if (
    activeDeviceStatuses.has(deviceStatus) ||
    (deviceStatus === 'downloading' &&
      device['download progress'] !== null &&
      device['download progress'] !== undefined)
  ) {
    return true;
  }

  return imageInstalls.some((install) => {
    if (!install) {
      return false;
    }

    const installStatus = normalizeStatus(install.status);
    return (
      activeDeviceStatuses.has(installStatus) ||
      (installStatus === 'downloading' &&
        install['download progress'] !== null &&
        install['download progress'] !== undefined)
    );
  });
};

export const getDeviceOverallState = (device: DeviceStatusRecord, imageInstalls: DeviceStatusRecord[] = []): string => {
  if (!device) {
    return 'Unknown';
  }

  const heartbeatState = normalizeStatus(device['api heartbeat state']);
  const updateStatus = normalizeStatus(device['update status']);
  const provisioningState = normalizeStatus(device['provisioning state']);
  const hasLastConnectivityEvent = Boolean(device['last connectivity event']);
  const online = isDeviceOnline(device);

  if (provisioningState === 'post-provisioning' || device['provisioning progress'] != null) {
    return 'Configuring';
  }

  if (!online) {
    if (!hasLastConnectivityEvent) {
      return 'Configuring';
    }

    return heartbeatState === 'online' ? 'Reduced functionality' : 'Disconnected';
  }

  if (failedUpdateStatuses.has(updateStatus)) {
    return 'Update failed';
  }

  if (isDeviceUpdating(device, imageInstalls)) {
    return 'Updating';
  }

  if (heartbeatState === 'timeout' || (heartbeatState !== 'online' && heartbeatState !== '')) {
    return 'Reduced functionality';
  }

  return 'Operational';
};
