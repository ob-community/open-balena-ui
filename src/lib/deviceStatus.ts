type DeviceStatusRecord = Record<string, unknown> | null | undefined;

const normalizeStatus = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

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
  const vpnConnected = device['is connected to vpn'] === true;

  if (provisioningState === 'post-provisioning' || device['provisioning progress'] != null) {
    return 'Configuring';
  }

  if (!vpnConnected) {
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

  return vpnConnected ? 'Operational' : 'Unknown';
};
