export const getProgressPercentage = (value: unknown): number | undefined => {
  const progress = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : undefined;
};

export interface DeviceOsUpdateProgress {
  stage: string;
  progress?: number;
  status: 'active' | 'failed' | 'complete';
}

export const getDeviceOsUpdateProgress = (
  device: Record<string, unknown> | null | undefined,
): DeviceOsUpdateProgress | undefined => {
  const stage = device?.['provisioning state'];
  if (typeof stage !== 'string') return undefined;
  const normalized = stage.trim().toLowerCase().replace(/[.,]$/, '');
  const activeStages = [
    'preparing os update',
    'running os update',
    'patching supervisor update',
    'running supervisor update',
  ];
  const failed = normalized === 'os update failed';
  const complete = normalized === 'update successful, rebooting' || normalized === 'update successful pending reboot';
  if (!failed && !complete && !activeStages.includes(normalized)) return undefined;
  return {
    stage: stage.trim(),
    progress: getProgressPercentage(device?.['provisioning progress']),
    status: failed ? 'failed' : complete ? 'complete' : 'active',
  };
};
