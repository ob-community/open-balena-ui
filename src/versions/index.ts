import * as semver from 'semver';

interface VersionMapping {
  resources: Record<string, string>;
  fields: Record<string, string>;
  translations: Record<string, string>;
}

const versions: Record<string, VersionMapping> = {
  '0.139.0': {
    resources: {
      isPinnedOnRelease: 'should be running-release',
    },
    fields: {
      // Before API v45, the UI's "online" filter is based on
      // the device heartbeat state.
      deviceOnlineStatus: 'api heartbeat state',
    },
    translations: {},
  },
};

versions['0.149.0'] = {
  resources: {
    ...versions['0.139.0'].resources,
  },
  fields: {
    ...versions['0.139.0'].fields,
    releaseIsFinalizedAtDate: 'is_finalized_at__date',
    releaseSemverMajor: 'semver_major',
    releaseSemverMinor: 'semver_minor',
    releaseSemverPatch: 'semver_patch',
    releaseRevision: 'revision',
    releaseIsFinal: 'is_final',
    releaseSemver: 'semver',
  },
  translations: {
    ...versions['0.139.0'].translations,
  },
};

versions['0.157.3'] = {
  resources: {
    ...versions['0.149.0'].resources,
  },
  fields: {
    ...versions['0.149.0'].fields,
    applicationIsOfClass: 'is of-class',
  },
  translations: {
    ...versions['0.149.0'].translations,
  },
};

versions['0.158.0'] = {
  resources: {
    ...versions['0.157.3'].resources,
  },
  fields: {
    ...versions['0.157.3'].fields,
    releaseKnownIssueList: 'known issue list',
  },
  translations: {
    ...versions['0.157.3'].translations,
  },
};

versions['0.170.0'] = {
  resources: {
    ...versions['0.158.0'].resources,
  },
  fields: {
    ...versions['0.158.0'].fields,
    releaseNote: 'note',
  },
  translations: {
    ...versions['0.158.0'].translations,
  },
};

versions['0.171.0'] = {
  resources: {
    ...versions['0.170.0'].resources,
  },
  fields: {
    ...versions['0.170.0'].fields,
    releaseInvalidationReason: 'invalidation reason',
  },
  translations: {
    ...versions['0.170.0'].translations,
  },
};

versions['0.185.0'] = {
  resources: {
    ...versions['0.171.0'].resources,
    deviceTypeAlias: 'device type alias',
  },
  fields: {
    ...versions['0.171.0'].fields,
  },
  translations: {
    ...versions['0.171.0'].translations,
  },
};

versions['25.2.8'] = {
  resources: {
    ...versions['0.185.0'].resources,

    // v25.2.8 removes the old writable
    // device.should_be_running__release relationship.
    isPinnedOnRelease: 'is pinned on-release',
  },
  fields: {
    ...versions['0.185.0'].fields,
  },
  translations: {
    ...versions['0.185.0'].translations,
  },
};

versions['45.0.0'] = {
  resources: {
    ...versions['25.2.8'].resources,
  },
  fields: {
    ...versions['25.2.8'].fields,

    // v45 switches the canonical connectivity/online semantics
    // from the heartbeat-based state to VPN connectivity.
    deviceOnlineStatus: 'is connected to vpn',
  },
  translations: {
    ...versions['25.2.8'].translations,
  },
};

const getTargetVersion = (version?: string): string => {
  const availableVersions = Object.keys(versions);
  const sortedVersions = semver.sort([...availableVersions]);
  const newestVersion = sortedVersions[sortedVersions.length - 1];
  const oldestVersion = sortedVersions[0];

  if (!version) {
    return newestVersion;
  }

  const [, versionNumber] = version.split('v');
  const candidate = versionNumber ?? version;
  const target = semver.maxSatisfying(availableVersions, `<=${candidate}`);

  return target ?? oldestVersion;
};

const resource = (resourceKey: string, version?: string): string => {
  const targetVer = getTargetVersion(version);
  const mapping = versions[targetVer];

  return mapping.resources[resourceKey] ?? resourceKey;
};

const field = (fieldKey: string, version?: string): string => {
  const targetVer = getTargetVersion(version);
  const mapping = versions[targetVer];

  return mapping.fields[fieldKey] ?? fieldKey;
};

const optionalResource = (resourceKey: string, version?: string): string | undefined => {
  const targetVer = getTargetVersion(version);
  return versions[targetVer].resources[resourceKey];
};

const optionalField = (fieldKey: string, version?: string): string | undefined => {
  const targetVer = getTargetVersion(version);
  return versions[targetVer].fields[fieldKey];
};

export default { resource, field, optionalResource, optionalField };
