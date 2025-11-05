import CopyChip from '../../ui/CopyChip';
import {
  FunctionField,
  Link,
  ReferenceField,
  TextField,
  Title,
  Loading,
  useGetOne,
  useRecordContext,
  RecordContextProvider,
} from 'react-admin';
import { styled, Box, Tooltip, Chip } from '@mui/material';
import dateFormat from 'dateformat';
import SemVerChip from '../../ui/SemVerChip';
import React from 'react';
import { resolveDeviceTargetRelease } from '../../lib/targetRelease';
import TargetReleaseIcon from '../../ui/TargetReleaseIcon';
import versions from '../../versions';
import environment from '../../lib/reactAppEnv';
import TargetReleaseTooltip from '../../ui/TargetReleaseTooltip';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

const TargetRelease: React.FC = () => {
  const record = useRecordContext();

  if (!record) {
    return null;
  }

  const applicationId = record['belongs to-application'];
  const needsFleetFallback = !record['should be running-release'] && Boolean(applicationId);

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
      <ReferenceField source={targetField} reference='release' target='id' link={false}>
        <TargetReleaseTooltip origin={origin}>
          <SemVerChip icon={<TargetReleaseIcon origin={origin} fontSize='small' />} withTooltip={false} />
        </TargetReleaseTooltip>
      </ReferenceField>
    </RecordContextProvider>
  );
};

const SummaryWidget: React.FC = () => {
  const record = useRecordContext();

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
                <Label>State</Label>
                <span>{record.status}</span>
              </td>

              <td>
                <Label>Device Type</Label>
                <ReferenceField source='is of-device type' reference='device type' target='id' link={false}>
                  <TextField source='slug' />
                </ReferenceField>
              </td>
            </tr>

            <tr>
              <td>
                <Label>OS Version</Label>
                <Link to='https://github.com/balena-os/meta-balena/blob/master/CHANGELOG.md' target='_blank'>
                  {record['os version']}
                </Link>
              </td>

              <td>
                <Label>OS Variant</Label>
                {record['os variant']}
              </td>

              <td>
                <Label>VPN State</Label>
                <FunctionField
                  render={(fieldRecord) => (
                    <Tooltip
                      placement='top'
                      arrow={true}
                      title={'Since ' + dateFormat(new Date(fieldRecord['last vpn event']))}
                    >
                      <span>{fieldRecord['is connected to vpn'] ? 'Connected' : 'Disconnected'}</span>
                    </Tooltip>
                  )}
                />
              </td>
            </tr>

            <tr>
              <td>
                <Label>Supervisor Version</Label>
                <TextField source='supervisor version' />
              </td>

              <td>
                <Label>Current Release</Label>
                <ReferenceField source='is running-release' reference='release' target='id'>
                  <SemVerChip />
                </ReferenceField>
              </td>

              <td>
                <Label>Target Release</Label>
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
                  <CopyChip
                    key={ip}
                    placement='left'
                    style={{ marginBottom: '5px' }}
                    title={ip}
                    label={ip.length > 15 ? ip.slice(0, 14) + '...' : ip}
                  />
                ))}
              </td>

              <td>
                <Label>Public IP Addresses</Label>
                {record['public address']?.split(' ').map((ip) => (
                  <CopyChip
                    key={ip}
                    placement='left'
                    style={{ marginBottom: '5px' }}
                    title={ip}
                    label={ip.length > 15 ? ip.slice(0, 15) + '...' : ip}
                  />
                ))}
              </td>
            </tr>

            <tr>
              <td colSpan={3}>
                <Label>Notes</Label>
                <p>{record.note}</p>
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
  display: 'block',
  textTransform: 'uppercase',
  marginBottom: '6px',
}));

export default SummaryWidget;
