import { json, Router } from 'express';
import semver from 'semver';
import authorize from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';
import versions from '../../src/versions';
import { BalenaOsSyncManager, BalenaOsSyncValidationError } from '../balenaOsSync';

interface UpdateOption {
  id: number | string;
  version: string;
  knownIssues?: string[];
  target?: 'release' | 'version';
}

const router = Router();
router.use(json());

const apiUrl = (): string => {
  const value = process.env.REACT_APP_OPEN_BALENA_API_URL;
  if (!value) {
    throw new Error('REACT_APP_OPEN_BALENA_API_URL must be configured.');
  }
  return value.replace(/\/+$/, '');
};

const catalogApiUrl = (): string =>
  (process.env.OPEN_BALENA_OS_CATALOG_API_URL ?? 'https://api.balena-cloud.com').replace(/\/+$/, '');

const odataVersion = (): 'v6' | 'v7' => {
  const override = process.env.REACT_APP_OPEN_BALENA_ODATA_VERSION;
  if (override === 'v6' || override === '6') return 'v6';
  if (override === 'v7' || override === '7') return 'v7';
  return versions.odataVersion(process.env.REACT_APP_OPEN_BALENA_API_VERSION);
};

const supportsReleaseSemverFields = (): boolean => {
  const version = semver.coerce(process.env.REACT_APP_OPEN_BALENA_API_VERSION);
  return !version || semver.gte(version, '0.149.0');
};

const encodeQueryValue = (value: string): string =>
  encodeURIComponent(value).replace(/%2C/gi, ',').replace(/%2F/gi, '/').replace(/%3A/gi, ':');

const collectionUrl = (
  baseUrl: string,
  version: 'v6' | 'v7',
  resource: string,
  query: Record<string, string | number>,
): string =>
  `${baseUrl}/${version}/${resource}?${Object.entries(query)
    .map(([key, value]) => `${key}=${encodeQueryValue(String(value))}`)
    .join('&')}`;

const extractRecords = (input: unknown): Array<Record<string, unknown>> => {
  if (!input || typeof input !== 'object') return [];
  const envelope = input as Record<string, unknown>;
  if (Array.isArray(envelope.value)) return envelope.value as Array<Record<string, unknown>>;
  if (Array.isArray(envelope.d)) return envelope.d as Array<Record<string, unknown>>;
  if (envelope.d && typeof envelope.d === 'object') {
    const legacy = envelope.d as Record<string, unknown>;
    if (Array.isArray(legacy.results)) return legacy.results as Array<Record<string, unknown>>;
  }
  return [];
};

const fetchRecords = async (
  authorization: string,
  version: 'v6' | 'v7',
  resource: string,
  query: Record<string, string | number>,
): Promise<Array<Record<string, unknown>>> => {
  const response = await fetch(collectionUrl(apiUrl(), version, resource, query), {
    headers: { Accept: 'application/json', Authorization: authorization },
  });
  if (!response.ok) {
    throw new Error(`open-balena-api ${resource} query failed with status ${response.status}.`);
  }
  return extractRecords(await response.json());
};

const fetchCatalogRecords = async (
  resource: string,
  query: Record<string, string | number>,
): Promise<Array<Record<string, unknown>>> => {
  const response = await fetch(collectionUrl(catalogApiUrl(), 'v7', resource, query), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Balena catalog ${resource} query failed with status ${response.status}.`);
  }
  return extractRecords(await response.json());
};

const parseVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .replace(/^balenaOS\s+/i, '')
    .replace(/^v(?=\d)/i, '');
  return semver.parse(normalized)?.raw ?? semver.coerce(normalized)?.version;
};

const relationId = (value: unknown): number => {
  const candidate = value && typeof value === 'object' && '__id' in value ? (value as { __id: unknown }).__id : value;
  return Number(candidate);
};

const knownIssues = (value: unknown): string[] => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((issue) => {
    if (typeof issue === 'string' && issue.trim()) return [issue.trim()];
    if (issue && typeof issue === 'object') {
      const record = issue as Record<string, unknown>;
      const description = record.description ?? record.message ?? record.title;
      if (typeof description === 'string' && description.trim()) return [description.trim()];
    }
    return [];
  });
};

const newerOptions = (records: UpdateOption[], currentVersion: string): UpdateOption[] => {
  const current = semver.parse(currentVersion) ?? semver.coerce(currentVersion);
  if (!current) return [];
  const revision = (version: semver.SemVer): number | undefined => {
    const value = version.build.map((part) => /^rev(\d+)$/.exec(part)?.[1]).find((part) => part != null);
    return value == null ? undefined : Number(value);
  };

  const compareVersions = (left: semver.SemVer, right: semver.SemVer): number => {
    const precedence = semver.compare(left, right);
    if (precedence !== 0) return precedence;
    const leftRevision = revision(left);
    const rightRevision = revision(right);
    if (leftRevision != null || rightRevision != null) return (leftRevision ?? -1) - (rightRevision ?? -1);
    return left.raw.localeCompare(right.raw);
  };
  const unique = new Map<string, UpdateOption>();
  for (const record of records) {
    const version = semver.parse(record.version) ?? semver.coerce(record.version);
    if (version && compareVersions(version, current) > 0) {
      unique.set(version.raw, {
        id: record.id,
        version: version.raw,
        ...(record.knownIssues?.length ? { knownIssues: record.knownIssues } : {}),
        ...(record.target ? { target: record.target } : {}),
      });
    }
  }
  return [...unique.values()].sort((left, right) => {
    const leftVersion = semver.parse(left.version)!;
    const rightVersion = semver.parse(right.version)!;
    return compareVersions(rightVersion, leftVersion);
  });
};

const versionFloor = (version: semver.SemVer): string =>
  `((semver_major gt ${version.major}) or ((semver_major eq ${version.major}) and (semver_minor gt ${version.minor})) or ((semver_major eq ${version.major}) and (semver_minor eq ${version.minor}) and (semver_patch ge ${version.patch})))`;

const getOperatingSystemReleases = async (
  authorization: string,
  version: 'v6' | 'v7',
  deviceTypeId: number,
  deviceTypeSlug: string,
  currentVersion: string,
): Promise<UpdateOption[]> => {
  if (supportsReleaseSemverFields()) {
    const parsedCurrentVersion = new semver.SemVer(currentVersion);
    const filter = [
      'is_final eq true',
      'is_invalidated eq false',
      "status eq 'success'",
      'semver_major gt 0',
      `belongs_to__application/any(app:(app/is_host eq true) and (app/is_for__device_type/any(type:type/slug eq '${deviceTypeSlug.replace(/'/g, "''")}')))`,
      versionFloor(parsedCurrentVersion),
    ]
      .map((clause) => `(${clause})`)
      .join(' and ');
    const releases = await fetchRecords(authorization, version, 'release', {
      $filter: filter,
      $orderby: 'semver_major desc,semver_minor desc,semver_patch desc,revision desc',
      $select: 'id,raw_version,semver_major,semver_minor,semver_patch,revision,known_issue_list',
      $top: 1000,
    });
    return releases.flatMap((record) => {
      const id = Number(record.id);
      const releaseVersion = parseVersion(record.raw_version);
      const issues = knownIssues(record.known_issue_list);
      return Number.isInteger(id) && releaseVersion
        ? [{ id, version: releaseVersion, ...(issues.length ? { knownIssues: issues } : {}) }]
        : [];
    });
  }

  const applications = await fetchRecords(authorization, version, 'application', {
    $filter: `(is_host eq true) and (is_for__device_type eq ${deviceTypeId})`,
    $select: 'id',
    $top: 1000,
  });
  const applicationIds = applications.map(({ id }) => Number(id)).filter(Number.isInteger);
  if (applicationIds.length === 0) return [];

  const releases = await fetchRecords(authorization, version, 'release', {
    $filter: `(${applicationIds.map((id) => `belongs_to__application eq ${id}`).join(' or ')})`,
    $select: 'id',
    $top: 1000,
  });
  const releaseIds = releases.map(({ id }) => Number(id)).filter(Number.isInteger);
  if (releaseIds.length === 0) return [];

  const releaseTags = await fetchRecords(authorization, version, 'release_tag', {
    $filter: `(tag_key eq 'version') and (${releaseIds.map((id) => `release eq ${id}`).join(' or ')})`,
    $select: 'release,value',
    $top: 1000,
  });
  return releaseTags.flatMap((record) => {
    const id = relationId(record.release);
    const releaseVersion = parseVersion(record.value);
    return Number.isInteger(id) && releaseVersion ? [{ id, version: releaseVersion }] : [];
  });
};

const getLocalSupervisorReleases = async (
  authorization: string,
  version: 'v6' | 'v7',
  deviceTypeId: number,
  cpuArchitectureId: number,
  currentVersion: string,
): Promise<UpdateOption[]> => {
  if (supportsReleaseSemverFields()) {
    const parsedCurrentVersion = new semver.SemVer(currentVersion);
    const filter = [
      'is_invalidated eq false',
      "status eq 'success'",
      `belongs_to__application/any(app:(startswith(app/slug,'balena_os/')) and (endswith(app/slug,'-supervisor')) and (app/is_public eq true) and (app/is_host eq false) and (app/is_for__device_type/any(type:type/is_of__cpu_architecture/any(architecture:architecture/id eq ${cpuArchitectureId}))))`,
      versionFloor(parsedCurrentVersion),
    ]
      .map((clause) => `(${clause})`)
      .join(' and ');
    const releases = await fetchRecords(authorization, version, 'release', {
      $filter: filter,
      $orderby: 'semver_major desc,semver_minor desc,semver_patch desc,revision desc',
      $select: 'id,raw_version,semver_major,semver_minor,semver_patch,revision',
      $top: 1000,
    });
    return releases.flatMap((record) => {
      const id = Number(record.id);
      const releaseVersion = parseVersion(record.raw_version);
      return Number.isInteger(id) && releaseVersion ? [{ id, version: releaseVersion }] : [];
    });
  }

  const applications = await fetchRecords(authorization, version, 'application', {
    $filter: `(is_host eq false) and (is_for__device_type eq ${deviceTypeId})`,
    $select: 'id,slug',
    $top: 1000,
  });
  const applicationIds = applications
    .filter(({ slug }) => typeof slug === 'string' && slug.startsWith('balena_os/') && slug.endsWith('-supervisor'))
    .map(({ id }) => Number(id))
    .filter(Number.isInteger);
  if (applicationIds.length === 0) return [];

  const releases = await fetchRecords(authorization, version, 'release', {
    $filter: `(${applicationIds.map((id) => `belongs_to__application eq ${id}`).join(' or ')})`,
    $select: 'id',
    $top: 1000,
  });
  const releaseIds = releases.map(({ id }) => Number(id)).filter(Number.isInteger);
  if (releaseIds.length === 0) return [];

  const releaseTags = await fetchRecords(authorization, version, 'release_tag', {
    $filter: `(tag_key eq 'version') and (${releaseIds.map((id) => `release eq ${id}`).join(' or ')})`,
    $select: 'release,value',
    $top: 1000,
  });
  return releaseTags.flatMap((record) => {
    const id = relationId(record.release);
    const releaseVersion = parseVersion(record.value);
    return Number.isInteger(id) && releaseVersion ? [{ id, version: releaseVersion }] : [];
  });
};

const getPublicSupervisorReleases = async (cpuArchitectureSlug: string): Promise<UpdateOption[]> => {
  const escapedSlug = cpuArchitectureSlug.replace(/'/g, "''");
  const filter = [
    "status eq 'success'",
    'is_final eq true',
    'is_invalidated eq false',
    'semver_major gt 0',
    `belongs_to__application/any(app:(startswith(app/slug,'balena_os/')) and (endswith(app/slug,'-supervisor')) and (app/is_public eq true) and (app/is_host eq false) and (app/is_for__device_type/any(type:type/is_of__cpu_architecture/any(architecture:architecture/slug eq '${escapedSlug}'))))`,
  ]
    .map((clause) => `(${clause})`)
    .join(' and ');
  const releases = await fetchCatalogRecords('release', {
    $filter: filter,
    $orderby: 'semver_major desc,semver_minor desc,semver_patch desc,revision desc',
    $select: 'id,raw_version',
    $top: 1000,
  });
  return releases.flatMap((record) => {
    const releaseVersion = parseVersion(record.raw_version);
    return releaseVersion ? [{ id: releaseVersion, version: releaseVersion, target: 'version' as const }] : [];
  });
};

const getSupervisorReleases = async (
  authorization: string,
  version: 'v6' | 'v7',
  deviceTypeId: number,
  cpuArchitectureId: number,
  cpuArchitectureSlug: string,
  currentVersion: string,
): Promise<UpdateOption[]> => {
  const localReleases = await getLocalSupervisorReleases(
    authorization,
    version,
    deviceTypeId,
    cpuArchitectureId,
    currentVersion,
  );
  const publicReleases = await getPublicSupervisorReleases(cpuArchitectureSlug);
  return [...publicReleases, ...localReleases.map((release) => ({ ...release, target: 'release' as const }))];
};

router.get('/device-update-options', ...dosProtect, authorize, async (req, res) => {
  const deviceTypeId = Number(req.query.deviceTypeId);
  const currentOsVersion = parseVersion(req.query.currentOsVersion);
  const currentSupervisorVersion = parseVersion(req.query.currentSupervisorVersion);
  if (!Number.isInteger(deviceTypeId) || deviceTypeId <= 0 || !currentOsVersion || !currentSupervisorVersion) {
    res.status(400).json({ message: 'A valid device type, OS version, and supervisor version are required.' });
    return;
  }

  try {
    const authorization = req.headers.authorization!;
    const version = odataVersion();
    const deviceTypes = await fetchRecords(authorization, version, 'device_type', {
      $filter: `id eq ${deviceTypeId}`,
      $select: 'id,slug,is_of__cpu_architecture',
      $top: 1,
    });
    const deviceTypeSlug = deviceTypes[0]?.slug;
    const cpuArchitectureId = relationId(deviceTypes[0]?.is_of__cpu_architecture);
    if (
      typeof deviceTypeSlug !== 'string' ||
      deviceTypeSlug.length === 0 ||
      !Number.isInteger(cpuArchitectureId) ||
      cpuArchitectureId <= 0
    ) {
      res.status(404).json({ message: 'The device type does not exist.' });
      return;
    }
    const cpuArchitectures = await fetchRecords(authorization, version, 'cpu_architecture', {
      $filter: `id eq ${cpuArchitectureId}`,
      $select: 'id,slug',
      $top: 1,
    });
    const cpuArchitectureSlug = cpuArchitectures[0]?.slug;
    if (typeof cpuArchitectureSlug !== 'string' || cpuArchitectureSlug.length === 0) {
      res.status(404).json({ message: 'The device CPU architecture does not exist.' });
      return;
    }

    const [osReleases, supervisorReleases] = await Promise.all([
      getOperatingSystemReleases(authorization, version, deviceTypeId, deviceTypeSlug, currentOsVersion),
      getSupervisorReleases(
        authorization,
        version,
        deviceTypeId,
        cpuArchitectureId,
        cpuArchitectureSlug,
        currentSupervisorVersion,
      ),
    ]);

    const operatingSystems = newerOptions(osReleases, currentOsVersion);
    const supervisors = newerOptions(supervisorReleases, currentSupervisorVersion);

    res.json({ operatingSystems, supervisors });
  } catch (error) {
    res.status(502).json({
      message: error instanceof Error ? error.message : 'Unable to load device update options.',
    });
  }
});

router.post('/device-supervisor-target', ...dosProtect, authorize, async (req, res) => {
  try {
    const deviceId = Number(req.body?.deviceId);
    const version = typeof req.body?.version === 'string' ? req.body.version.trim() : '';
    if (!Number.isInteger(deviceId) || deviceId <= 0 || !version) {
      res.status(400).json({ message: 'A valid device and Supervisor version are required.' });
      return;
    }
    const result = await new BalenaOsSyncManager().setSupervisorTarget(req.headers.authorization!, deviceId, version);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to set the Supervisor target.';
    res.status(error instanceof BalenaOsSyncValidationError ? 400 : 502).json({ message });
  }
});

export default router;
