import { relationshipId } from './deviceServicePresentation';
import { isDeviceUpdating } from './deviceStatus';
import type { ResourceRecord } from '../types/resource';

export const steadyDeviceRefreshMs = 30_000;
export const activeDeviceRefreshMs = 1000;

const status = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, ' ');
const failures = new Set(['error', 'failed', 'update failed', 'aborted', 'rejected']);
const transitions = new Set(['configuring', 'updating', 'restarting', 'rebooting', 'creating', 'deleting']);

export const deviceRefreshFailure = (device?: Record<string, unknown>): string =>
  [device?.['overall status'], device?.['update status'], device?.status]
    .map(status)
    .filter((value) => failures.has(value))
    .join('|');

export const isDeviceRefreshActive = (
  device?: Record<string, unknown>,
  installs: Record<string, unknown>[] = [],
  targetReleaseId?: number | string,
): boolean => {
  if (!device || deviceRefreshFailure(device)) return false;
  const releases = [
    device['is running-release'],
    device['is pinned on-release'],
    device['should be running-release'],
    device['should be managed by-release'],
    targetReleaseId,
  ]
    .map(relationshipId)
    .filter((id) => id != null)
    .map(String);
  const relevant = installs.filter((install) => {
    const release = relationshipId(install['is provided by-release']);
    return release == null || !releases.length || releases.includes(String(release));
  });
  return (
    isDeviceUpdating(device, relevant) ||
    transitions.has(status(device['overall status'])) ||
    transitions.has(status(device.status)) ||
    transitions.has(status(device['update status'])) ||
    status(device['provisioning state']) === 'post provisioning' ||
    device['provisioning progress'] != null ||
    relevant.some((install) => transitions.has(status(install.status)))
  );
};

export interface RefreshTargets {
  hostVersion?: string;
  supervisorVersion?: string;
  appReleaseId?: number | string;
}
const version = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .trim()
        .replace(/^balenaOS\s+/i, '')
        .replace(/^v(?=\d)/i, '')
    : '';
const sameId = (a: unknown, b: unknown): boolean => String(relationshipId(a) ?? '') === String(relationshipId(b) ?? '');

export const hasUnreachedDeviceTarget = (device: ResourceRecord | undefined, targets: RefreshTargets = {}): boolean =>
  Boolean(
    device &&
    !deviceRefreshFailure(device) &&
    ((targets.hostVersion && version(targets.hostVersion) !== version(device['os version'])) ||
      (targets.supervisorVersion && version(targets.supervisorVersion) !== version(device['supervisor version'])) ||
      (targets.appReleaseId != null && !sameId(device['is running-release'], targets.appReleaseId))),
  );

export type DeviceActionRequest =
  | {
      deviceId: number | string;
      kind: 'host-os' | 'supervisor' | 'release';
      targetField: string;
      targetReleaseId: number | string | null;
      targetVersion?: string;
      baselineFailure?: string;
    }
  | {
      deviceId: number | string;
      kind: 'start' | 'stop' | 'restart';
      imageInstallId: number | string;
      imageId?: number | string;
    };

export type PendingDeviceAction = DeviceActionRequest & {
  id: string;
  startedAt: number;
  acknowledgedAt?: number;
  observedActive?: boolean;
  observedTarget?: boolean;
};

export const settleDeviceActions = (
  actions: PendingDeviceAction[],
  device: ResourceRecord | undefined,
  installs: ResourceRecord[],
  freshness: { device: number; installs: number },
  targets: RefreshTargets = {},
): PendingDeviceAction[] => {
  let changed = false;
  const remaining: PendingDeviceAction[] = [];
  for (const action of actions) {
    const active = isDeviceRefreshActive(device, installs, targets.appReleaseId);
    const observed = action.observedActive || active;
    let observedTarget = action.observedTarget;
    let complete = false;
    if (action.acknowledgedAt != null && device) {
      if ('imageInstallId' in action) {
        const install =
          installs.find((entry) => String(entry.id) === String(action.imageInstallId)) ??
          (action.imageId == null
            ? undefined
            : installs.find((entry) => sameId(entry['installs-image'], action.imageId)));
        if (freshness.installs > action.acknowledgedAt && !install && action.kind === 'stop') complete = true;
        else if (freshness.installs > action.acknowledgedAt && install) {
          const state = status(install.status);
          complete =
            failures.has(state) ||
            state === (action.kind === 'stop' ? 'stopped' : 'running') ||
            (action.kind === 'stop' && state === 'exited');
        }
      } else if (freshness.device > action.acknowledgedAt) {
        const failure = deviceRefreshFailure(device);
        if (failure && (failure !== action.baselineFailure || observed)) complete = true;
        else if (!sameId(device[action.targetField], action.targetReleaseId) && action.observedTarget) {
          // A different acknowledged target supersedes the requested change.
          complete = true;
        } else if (sameId(device[action.targetField], action.targetReleaseId) && !active) {
          observedTarget = true;
          if (action.kind === 'release') {
            const target =
              action.targetReleaseId ?? targets.appReleaseId ?? relationshipId(device['should be running-release']);
            complete =
              freshness.installs > action.acknowledgedAt &&
              (target == null ? Boolean(action.observedActive) : sameId(device['is running-release'], target));
          } else {
            const reported = device[action.kind === 'host-os' ? 'os version' : 'supervisor version'];
            const target =
              action.targetVersion ?? (action.kind === 'host-os' ? targets.hostVersion : targets.supervisorVersion);
            complete = action.targetReleaseId == null || Boolean(target && version(reported) === version(target));
          }
        } else if (sameId(device[action.targetField], action.targetReleaseId)) observedTarget = true;
      }
    }
    if (complete) {
      changed = true;
      continue;
    }
    if ((observed && !action.observedActive) || (observedTarget && !action.observedTarget)) {
      remaining.push({ ...action, observedActive: Boolean(observed), observedTarget: Boolean(observedTarget) });
      changed = true;
    } else remaining.push(action);
  }
  return changed ? remaining : actions;
};

export const getDeviceRefreshInterval = (
  device: ResourceRecord | undefined,
  installs: ResourceRecord[] = [],
  actions: PendingDeviceAction[] = [],
  targets: RefreshTargets = {},
): number =>
  actions.length ||
  isDeviceRefreshActive(device, installs, targets.appReleaseId) ||
  hasUnreachedDeviceTarget(device, targets)
    ? activeDeviceRefreshMs
    : steadyDeviceRefreshMs;
