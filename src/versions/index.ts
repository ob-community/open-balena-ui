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
    fields: {},
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
    isPinnedOnRelease: 'is pinned on-release',
  },
  fields: {
    ...versions['0.185.0'].fields,
  },
  translations: {
    ...versions['0.185.0'].translations,
  },
};

const getTargetVersion = (version?: string): string => {
  const availableVersions = Object.keys(versions);
  const fallback = semver.sort([...availableVersions]).pop() ?? availableVersions[availableVersions.length - 1];

  if (!version) {
    return fallback;
  }

  const [, versionNumber] = version.split('v');
  const candidate = versionNumber ?? version;
  const target = semver.maxSatisfying(availableVersions, `<=${candidate}`);

  return target ?? fallback;
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

export default { resource, field };
