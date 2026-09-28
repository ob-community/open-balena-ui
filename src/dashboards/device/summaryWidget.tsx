import CopyChip from '../../ui/CopyChip';
import {
  FunctionField,
  Link,
  ReferenceField,
  TextField,
  Title,
  Loading,
  useGetManyReference,
  useGetOne,
  useRecordContext,
  RecordContextProvider,
} from 'react-admin';
import { styled, Alert, Box, Chip } from '@mui/material';
import SemVerChip from '../../ui/SemVerChip';
import React from 'react';
import { resolveDeviceTargetRelease } from '../../lib/targetRelease';
import TargetReleaseIcon from '../../ui/TargetReleaseIcon';
import versions from '../../versions';
import environment from '../../lib/reactAppEnv';
import TargetReleaseTooltip from '../../ui/TargetReleaseTooltip';
import { getDeviceOverallState } from '../../lib/deviceStatus';
import type { ResourceRecord } from '../../types/resource';
import {
  DeviceFieldEditor,
  loadOperatingSystemChoices,
  loadSupervisorChoices,
  loadTargetReleaseChoices,
  saveSupervisorTarget,
  UnsupportedDeviceField,
} from '../../ui/DeviceFieldEditor';
import { queuedOsUpdateMode } from '../../lib/deviceServicePresentation';
import ConnectionLastConnected from '../../ui/ConnectionLastConnected';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
const deviceStateRefreshInterval = 30000;

export const formatOsVariant = (variant: unknown): string => {
  if (variant === 'prod') return 'Production';
  if (variant === 'dev') return 'Development';
  return typeof variant === 'string' ? variant : '';
};

const normalizedDeviceVersion = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/^balenaOS\s+/i, '') : '';

const expandedRelease = (value: unknown): ResourceRecord | undefined => {
  if (Array.isArray(value)) return expandedRelease(value[0]);
  return value && typeof value === 'object' ? (value as ResourceRecord) : undefined;
};

const releaseVersion = (record: ResourceRecord | undefined): unknown => record?.['raw version'] ?? record?.raw_version;

const releaseId = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  const expanded = expandedRelease(value);
  const id = expanded?.id ?? expanded?.__id;
  return typeof id === 'number' ? id : undefined;
};

const QueuedOsUpdateNotice: React.FC<{ supervisorVersion: unknown }> = ({ supervisorVersion }) => {
  const mode = queuedOsUpdateMode(supervisorVersion);

  return (
    <Box>
      <Alert severity='info' sx={{ mb: 1, mt: 1 }}>
        Though we always advise updating to the latest OS version, it&apos;s crucial to test compatibility with your
        application before proceeding. Stay up-to-date, but remember to verify first!
      </Alert>
      {mode === 'supervisor' ? (
        <Alert severity='info' sx={{ mb: 1 }}>
          This queued update is pulled and retried by Supervisor 19+ when the device next polls target state; Cloudlink
          is not required.
        </Alert>
      ) : mode === 'cloudlink' ? (
        <Alert severity='warning' sx={{ mb: 1 }}>
          This Supervisor cannot pull a queued Host OS update. Delivery requires the API-side transitional Cloudlink
          push mechanism; use Supervisor 19+ for pull-based updates and automatic retries.
        </Alert>
      ) : null}
    </Box>
  );
};

const DeviceVersionTransition: React.FC<{ reportedField: string; targetField: string }> = ({
  reportedField,
  targetField,
}) => {
  const record = useRecordContext<ResourceRecord>();
  const { data: refreshedDevice } = useGetOne<ResourceRecord>(
    'device',
    { id: record?.id ?? 0 },
    { enabled: record != null, refetchInterval: deviceStateRefreshInterval },
  );
  const currentRecord = refreshedDevice ?? record;
  const targetValue = currentRecord?.[targetField];
  const targetRecord = expandedRelease(targetValue);
  const targetReleaseId = releaseId(targetValue);
  const { data: fetchedTarget } = useGetOne<ResourceRecord>(
    'release',
    { id: targetReleaseId ?? 0 },
    { enabled: targetReleaseId != null && releaseVersion(targetRecord) == null },
  );
  if (!currentRecord) return null;
  const reportedVersion = normalizedDeviceVersion(currentRecord[reportedField]);
  const targetVersion = normalizedDeviceVersion(releaseVersion(targetRecord) ?? releaseVersion(fetchedTarget));
  return (
    <>
      {reportedVersion}
      {targetVersion && targetVersion !== reportedVersion ? ` \u2192 ${targetVersion}` : ''}
    </>
  );
};

const DeviceState: React.FC = () => {
  const record = useRecordContext<ResourceRecord>();
  const { data: imageInstalls = [] } = useGetManyReference<ResourceRecord>(
    'image install',
    {
      target: 'device',
      id: record?.id,
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    },
    {
      enabled: record?.id !== undefined && record?.id !== null,
      refetchInterval: deviceStateRefreshInterval,
      refetchIntervalInBackground: false,
    },
  );

  if (!record) {
    return null;
  }

  return <span>{getDeviceOverallState(record, imageInstalls)}</span>;
};

const TargetRelease: React.FC = () => {
  const record = useRecordContext();

  if (!record) {
    return null;
  }

  const applicationId = record['belongs to-application'];
  const needsFleetFallback = !record[isPinnedOnRelease] && Boolean(applicationId);

  const {
    data: fleet,
    isPending,
    error,
  } = useGetOne('application', { id: applicationId }, { enabled: needsFleetFallback });

  if (needsFleetFallback && isPending) {
    return <p>Loading</p>;
  }

  if (needsFleetFallback && error) {
    return <p>ERROR</p>;
  }

  const { targetReleaseId, origin } = resolveDeviceTargetRelease({
    record,
    fleetRecord: fleet,
    pinField: isPinnedOnRelease,
  });

  const targetField = '__targetReleaseId';

  if (targetReleaseId === undefined) {
    return (
      <TargetReleaseTooltip origin={origin} fallbackDetail='Tracking latest release'>
        <Chip
          icon={<TargetReleaseIcon origin={origin} fontSize='small' />}
          label='Latest'
          size='small'
          variant='outlined'
        />
      </TargetReleaseTooltip>
    );
  }

  const augmentedRecord =
    targetReleaseId !== record[targetField] ? { ...record, [targetField]: targetReleaseId } : record;

  return (
    <RecordContextProvider value={augmentedRecord}>
      <ReferenceField source={targetField} reference='release' link={false}>
        <TargetReleaseTooltip origin={origin}>
          <SemVerChip icon={<TargetReleaseIcon origin={origin} fontSize='small' />} withTooltip={false} />
        </TargetReleaseTooltip>
      </ReferenceField>
    </RecordContextProvider>
  );
};

const SummaryWidget: React.FC = () => {
  const record = useRecordContext<ResourceRecord>();

  if (!record) {
    return <Loading />;
  }

  return (
    <>
      <Title title='Summary' />
      <Box
        sx={{
          'px': '15px',
          'flex': 1,
          'td': {
            fontSize: '13px',
            verticalAlign: 'top',
            width: '33.3333333%',
            paddingTop: '30px',
          },
          'tr:first-of-type': {
            td: {
              paddingTop: '0',
            },
          },
        }}
      >
        <table style={{ width: '100%' }}>
          <tbody>
            <tr>
              <td>
                <Label>UUID</Label>
                <CopyChip title={record.uuid} label={record.uuid.substring(0, 7)} />
              </td>

              <td>
                <Label>Status</Label>
                <DeviceState />
              </td>

              <td>
                <Label>VPN Last Connected</Label>
                <FunctionField
                  render={(fieldRecord) => (
                    <ConnectionLastConnected
                      connected={fieldRecord['is connected to vpn'] === true}
                      timestamp={fieldRecord['last vpn event']}
                    />
                  )}
                />
              </td>
            </tr>

            <tr>
              <td>
                <Label>
                  Host OS Version
                  <DeviceFieldEditor
                    source='should be operated by-release'
                    title='Host OS version'
                    currentValue={record['should be operated by-release'] as number | null | undefined}
                    emptyLabel={`${record['os version']} (current)`}
                    emptyChoiceLast
                    defaultToFirstChoice
                    notice={<QueuedOsUpdateNotice supervisorVersion={record['supervisor version']} />}
                    loadChoices={loadOperatingSystemChoices}
                    iconOnly
                  />
                </Label>
                <DeviceVersionTransition reportedField='os version' targetField='should be operated by-release' /> (
                <Link to='https://github.com/balena-os/meta-balena/blob/master/CHANGELOG.md' target='_blank'>
                  Changelog
                </Link>
                )
              </td>

              <td>
                <Label>OS Variant</Label>
                {formatOsVariant(record['os variant'])}
              </td>

              <td>
                <Label>Device Type</Label>
                <ReferenceField source='is of-device type' reference='device type' link={false}>
                  <TextField source='slug' />
                </ReferenceField>
              </td>
            </tr>

            <tr>
              <td>
                <Label>
                  Supervisor Version
                  <DeviceFieldEditor
                    source='should be managed by-release'
                    title='Supervisor version'
                    currentValue={record['should be managed by-release'] as number | null | undefined}
                    emptyLabel={`${record['supervisor version']} (current)`}
                    emptyChoiceLast
                    defaultToFirstChoice
                    loadChoices={loadSupervisorChoices}
                    saveChoice={saveSupervisorTarget}
                    iconOnly
                  />
                </Label>
                <DeviceVersionTransition
                  reportedField='supervisor version'
                  targetField='should be managed by-release'
                />
              </td>

              <td>
                <Label>Current Release</Label>
                <ReferenceField source='is running-release' reference='release'>
                  <SemVerChip />
                </ReferenceField>
              </td>

              <td>
                <Label>
                  Target Release
                  <DeviceFieldEditor
                    source={isPinnedOnRelease}
                    title='Target release'
                    currentValue={record[isPinnedOnRelease] as number | null | undefined}
                    emptyLabel='Track fleet target'
                    loadChoices={loadTargetReleaseChoices}
                    iconOnly
                  />
                </Label>
                <TargetRelease />
              </td>
            </tr>

            <tr>
              <td>
                <Label>MAC Addresses</Label>
                {record['mac address']?.split(' ').map((mac) => (
                  <CopyChip key={mac} placement='left' style={{ marginBottom: '5px' }} title={mac} label={mac} />
                ))}
              </td>

              <td>
                <Label>Local IP Addresses</Label>
                {record['ip address']?.split(' ').map((ip) => (
                  <CopyChip key={ip} placement='left' style={{ marginBottom: '5px' }} title={ip} label={ip} />
                ))}
              </td>

              <td>
                <Label>Public IP Addresses</Label>
                {record['public address']
                  ? record['public address']
                      .split(' ')
                      .map((ip) => (
                        <CopyChip key={ip} placement='left' style={{ marginBottom: '5px' }} title={ip} label={ip} />
                      ))
                  : 'Unavailable'}
              </td>
            </tr>

            <tr>
              <td>
                <Label>Support Access</Label>
                <UnsupportedDeviceField>Unavailable</UnsupportedDeviceField>
              </td>
              <td colSpan={2}>
                <Label>
                  Notes
                  <DeviceFieldEditor
                    source='note'
                    title='Notes'
                    currentValue={record.note as string | undefined}
                    multiline
                    iconOnly
                  />
                </Label>
                <p>{record.note || 'No notes'}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </Box>
    </>
  );
};

const Label = styled('span')(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '11px',
  display: 'flex',
  alignItems: 'center',
  minHeight: '24px',
  textTransform: 'uppercase',
  marginBottom: '2px',
}));

export default SummaryWidget;
