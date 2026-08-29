type DeviceStatusRecord = Record<string, unknown> | null | undefined;

const normalizeStatus = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const parseTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const timestamp = new Date(String(value)).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const getDeviceActivityTimestamp = (device: DeviceStatusRecord): number | null => {
  if (!device) {
    return null;
  }

  const isOnline = normalizeStatus(device['api heartbeat state']) === 'online';
  const primaryTimestamp = parseTimestamp(
    device[isOnline ? 'changed api heartbeat state on-date' : 'last connectivity event'],
  );

  if (primaryTimestamp !== null) {
    return primaryTimestamp;
  }

  return isOnline ? parseTimestamp(device['last connectivity event']) : null;
};

export const compareDeviceConnectivity = (
  first: DeviceStatusRecord,
  second: DeviceStatusRecord,
  order: 'ASC' | 'DESC' = 'DESC',
): number => {
  const firstIsOnline = normalizeStatus(first?.['api heartbeat state']) === 'online';
  const secondIsOnline = normalizeStatus(second?.['api heartbeat state']) === 'online';
  let result = Number(secondIsOnline) - Number(firstIsOnline);

  if (result === 0) {
    const firstTimestamp = getDeviceActivityTimestamp(first);
    const secondTimestamp = getDeviceActivityTimestamp(second);

    if (firstTimestamp === null && secondTimestamp !== null) {
      result = 1;
    } else if (firstTimestamp !== null && secondTimestamp === null) {
      result = -1;
    } else if (firstTimestamp !== null && secondTimestamp !== null) {
      result = firstIsOnline ? firstTimestamp - secondTimestamp : secondTimestamp - firstTimestamp;
    }
  }

  if (result === 0) {
    result = String(first?.['device name'] ?? '').localeCompare(String(second?.['device name'] ?? ''));
  }

  return order === 'DESC' ? result : -result;
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

export const isDeviceUpdating = (
  device: DeviceStatusRecord,
  imageInstalls: DeviceStatusRecord[] = [],
): boolean => {
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

export const getDeviceOverallState = (
  device: DeviceStatusRecord,
  imageInstalls: DeviceStatusRecord[] = [],
): string => {
  if (!device) {
    return 'Unknown';
  }

  const heartbeatState = normalizeStatus(device['api heartbeat state']);
  const updateStatus = normalizeStatus(device['update status']);
  const provisioningState = normalizeStatus(device['provisioning state']);
  const hasLastConnectivityEvent = Boolean(device['last connectivity event']);
  const vpnConnected = device['is connected to vpn'] === true;

  if (provisioningState === 'post-provisioning' || device['provisioning progress'] != null) {
    return 'Configuring';
  }

  if ((heartbeatState === 'offline' || heartbeatState === 'unknown') && !vpnConnected) {
    return hasLastConnectivityEvent ? 'Disconnected' : 'Configuring';
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

  return heartbeatState === 'online' ? 'Operational' : 'Unknown';
};
