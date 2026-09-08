import { Tooltip, useTheme } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import dateFormat from 'dateformat';
import * as React from 'react';
import {
  Create,
  CreateButton,
  Datagrid,
  Edit,
  EditButton,
  ExportButton,
  FilterButton,
  FormDataConsumer,
  FunctionField,
  List,
  Pagination,
  ReferenceField,
  ReferenceInput,
  SearchInput,
  SelectInput,
  ShowButton,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  TopToolbar,
  required,
  useGetOne,
  useGetManyReference,
  useRedirect,
  useListContext,
  WithRecord,
  RecordContextProvider,
  FunctionFieldProps,
  PaginationProps,
  ListProps,
} from 'react-admin';
import { v4 as uuidv4 } from 'uuid';
import { useCreateDevice, useModifyDevice, useSetServicesForNewDevice } from '../lib/device';
import CopyChip from '../ui/CopyChip';
import DeleteDeviceButton, { DeleteDeviceButtonProps } from '../ui/DeleteDeviceButton';
import DeviceConnectButton from '../ui/DeviceConnectButton';
import DeviceServicesButton from '../ui/DeviceServicesButton';
import Row from '../ui/Row';
import SelectOperatingSystem from '../ui/SelectOperatingSystem';
import SemVerChip, { getSemver } from '../ui/SemVerChip';
import versions from '../versions';
import environment from '../lib/reactAppEnv';
import { resolveDeviceTargetRelease } from '../lib/targetRelease';
import TargetReleaseIcon from '../ui/TargetReleaseIcon';
import TargetReleaseTooltip from '../ui/TargetReleaseTooltip';
import DeviceStructuredFilter from '../ui/DeviceStructuredFilter';
import DeviceUpdateStatusIcon from '../ui/DeviceUpdateStatusIcon';
import {
  deviceOnlineStatusField,
  getDeviceStatusTimestamp,
  isDeviceOnline,
  isDeviceUpdating,
} from '../lib/deviceStatus';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
const deviceStatusRefreshInterval = 30000;

const parseDeviceDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatElapsedTime = (referenceDate: Date): string => {
  const elapsedMilliseconds = Math.max(0, Date.now() - referenceDate.getTime());
  const elapsedDays = Math.floor(elapsedMilliseconds / 86400000);

  if (elapsedDays >= 1) {
    return `${elapsedDays} ${elapsedDays === 1 ? 'day' : 'days'}`;
  }

  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60000);
  return `${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'}`;
};

const ElapsedTime: React.FC<{ referenceDate: Date; prefix?: string; suffix?: string }> = ({
  referenceDate,
  prefix = '',
  suffix = '',
}) => (
  <Tooltip placement='top' arrow title={dateFormat(referenceDate)}>
    <span>{`${prefix}${formatElapsedTime(referenceDate)}${suffix}`}</span>
  </Tooltip>
);

export const OnlineField: React.FC<Omit<FunctionFieldProps<any>, 'render'>> = (props) => {
  const theme = useTheme();

  return (
    <FunctionField
      {...props}
      render={(record, source) => {
        if (!source) {
          return null;
        }
        const online = isDeviceOnline(record);
        const heartbeatOnline = record['api heartbeat state'] === 'online';
        const noVpn = !online && heartbeatOnline && record['is connected to vpn'] !== true;
        const status = online ? 'Online' : noVpn ? 'NO VPN' : 'Offline';
        const statusColor = online
          ? theme.palette.success.light
          : noVpn
            ? theme.palette.warning.main
            : theme.palette.error.light;
        const statusTimestamp = getDeviceStatusTimestamp(record);
        const statusSince = parseDeviceDate(statusTimestamp);
        const statusSinceLabel = statusSince ? `Since ${dateFormat(statusSince)}` : '';

        return (
          <Tooltip placement='top' arrow={true} title={statusSinceLabel}>
            <strong style={{ color: statusColor }}>{status}</strong>
          </Tooltip>
        );
      }}
    />
  );
};

export const LastOnlineField: React.FC<Omit<FunctionFieldProps<any>, 'render'>> = (props) => (
  <FunctionField
    {...props}
    render={(record) => {
      const isOnline = isDeviceOnline(record);
      const referenceDate = parseDeviceDate(getDeviceStatusTimestamp(record));

      if (!referenceDate) {
        return isOnline ? '—' : 'Never online';
      }

      return (
        <ElapsedTime referenceDate={referenceDate} prefix={isOnline ? 'Up ' : ''} suffix={isOnline ? '' : ' ago'} />
      );
    }}
  />
);

export const ReleaseField: React.FC<Omit<FunctionFieldProps<any>, 'render'>> = (props) => {
  const theme = useTheme();

  return (
    <FunctionField
      {...props}
      render={(record, source) => <ReleaseFieldContent record={record} source={source} theme={theme} />}
    />
  );
};

const ReleaseFieldContent: React.FC<{
  record: Record<string, any> | null;
  source?: string;
  theme: Theme;
}> = ({ record, source, theme }) => {
  if (!record || !source) {
    return null;
  }

  const applicationId = record['belongs to-application'];
  const shouldFetchFleet = Boolean(applicationId);
  const {
    data: fleet,
    isPending,
    error,
  } = useGetOne('application', { id: applicationId }, { enabled: shouldFetchFleet });
  const deviceUpdateReported = isDeviceUpdating(record);
  const { data: updatingImageInstalls = [] } = useGetManyReference(
    'image install',
    {
      target: 'device',
      id: record.id,
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {
        'status@in': '(Downloading,Downloaded,Installing,Installed,Starting,Stopping,configuring)',
      },
    },
    {
      enabled: record.id !== undefined && record.id !== null && !deviceUpdateReported,
      refetchInterval: deviceStatusRefreshInterval,
      refetchIntervalInBackground: false,
    },
  );

  if (shouldFetchFleet && isPending) {
    return <p>Loading</p>;
  }

  if (shouldFetchFleet && error) {
    return <p>ERROR</p>;
  }

  const { targetReleaseId, origin } = resolveDeviceTargetRelease({
    record,
    fleetRecord: fleet,
    pinField: isPinnedOnRelease,
  });

  const targetField = '__targetReleaseId';
  const augmentedRecord =
    targetReleaseId !== record[targetField] ? { ...record, [targetField]: targetReleaseId } : record;

  const isTrackingLatest = origin === 'latest';
  const currentRelease = record[source];
  const hasTarget = targetReleaseId !== undefined && targetReleaseId !== null;
  const isTargetMatch =
    hasTarget && currentRelease !== undefined && currentRelease !== null
      ? String(currentRelease) === String(targetReleaseId)
      : false;

  const isUpToDate = hasTarget ? isTargetMatch : isTrackingLatest;
  const isUpdating = deviceUpdateReported || isDeviceUpdating(record, updatingImageInstalls);
  const updateStatus = isUpToDate ? undefined : isUpdating ? 'updating' : 'outdated';
  const chipIcon = isUpToDate && hasTarget ? <TargetReleaseIcon origin={origin} fontSize='small' /> : undefined;
  const isOnline = isDeviceOnline(record);
  const updateStatusColor =
    updateStatus === 'updating'
      ? theme.palette.info.main
      : updateStatus === 'outdated'
        ? isOnline
          ? theme.palette.warning.main
          : theme.palette.common.white
        : theme.palette.text.primary;

  return (
    <RecordContextProvider value={augmentedRecord}>
      <ReferenceField label='Current Release' source='is running-release' reference='release' target='id'>
        <SemVerChip icon={chipIcon} sx={{ position: 'relative', top: '-5px' }} withTooltip={false} />
      </ReferenceField>

      {record[source] &&
        (targetReleaseId !== undefined && targetReleaseId !== null ? (
          <ReferenceField reference='release' target='id' source={targetField} link={false}>
            <TargetReleaseTooltip origin={origin} status={updateStatus}>
              <span
                style={{
                  position: 'relative',
                  top: '3px',
                  left: '3px',
                  color: updateStatusColor,
                }}
              >
                {updateStatus && <DeviceUpdateStatusIcon status={updateStatus} />}
              </span>
            </TargetReleaseTooltip>
          </ReferenceField>
        ) : (
          <TargetReleaseTooltip origin={origin} status={updateStatus} fallbackDetail='Tracking latest release'>
            <span
              style={{
                position: 'relative',
                top: '3px',
                left: '3px',
                color: updateStatusColor,
              }}
            >
              {updateStatus && <DeviceUpdateStatusIcon status={updateStatus} />}
            </span>
          </TargetReleaseTooltip>
        ))}
    </RecordContextProvider>
  );
};

const CustomBulkActionButtons: React.FC<DeleteDeviceButtonProps> = (props) => {
  const { selectedIds } = useListContext();

  return (
    <React.Fragment>
      <DeleteDeviceButton size='small' selectedIds={selectedIds} {...props}>
        Delete Selected Devices
      </DeleteDeviceButton>
    </React.Fragment>
  );
};

const ExtendedPagination: React.FC<PaginationProps> = ({
  rowsPerPageOptions = [5, 10, 25, 50, 100, 250],
  ...props
}) => <Pagination rowsPerPageOptions={rowsPerPageOptions} {...props} />;

// Standard react-admin filters array (like apiKey.tsx pattern)
const deviceFilters = [
  <SearchInput source='#uuid,device name,status@ilike' alwaysOn key='search' />,
  <DeviceStructuredFilter alwaysOn key='structured' />,
];

// Custom actions with styled FilterButton for saved queries feature
// Note: This is a bit of a hack, but it works for now.
const DeviceListActions = () => (
  <TopToolbar
    sx={{
      // Target the FilterButton using its add-filter class
      '& .add-filter': {
        // Hide original icon and replace with bookmark icon
        '& .MuiButton-startIcon': {
          '& svg': {
            display: 'none',
          },
          '&::before': {
            content: '""',
            display: 'block',
            width: '18px',
            height: '18px',
            mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E")`,
            maskSize: 'contain',
            backgroundColor: 'currentColor',
          },
        },
        // Hide original text - the text is directly in the button
        'fontSize': 0,
        '&::after': {
          content: '"Save Filters"',
          fontSize: '0.8125rem',
        },
      },
    }}
  >
    <FilterButton />
    <CreateButton />
    <ExportButton />
  </TopToolbar>
);

export const DeviceList: React.FC<ListProps<any>> = (props) => {
  return (
    <List
      {...props}
      filters={deviceFilters}
      actions={<DeviceListActions />}
      sort={{ field: 'connectivity', order: 'DESC' }}
      pagination={<ExtendedPagination />}
      queryOptions={{ refetchInterval: deviceStatusRefreshInterval, refetchIntervalInBackground: false }}
    >
      <Datagrid rowClick={false} bulkActionButtons={<CustomBulkActionButtons />} size='medium'>
        <ReferenceField label='Name' source='id' reference='device' target='id' link='show'>
          <TextField source='device name' />
        </ReferenceField>

        <OnlineField label='Status' source={deviceOnlineStatusField} />

        <ReleaseField label='Current Release' source='is running-release' />

        <ReferenceField label='Fleet' source='belongs to-application' reference='application' target='id'>
          <TextField source='app name' />
        </ReferenceField>

        <ReferenceField label='Device Type' source='is of-device type' reference='device type' target='id' link={false}>
          <TextField source='slug' />
        </ReferenceField>

        <FunctionField
          label='OS'
          render={(record) =>
            record['os version'] && record['os variant'] ? `${record['os version']}-${record['os variant']}` : ''
          }
        />

        <LastOnlineField label='Connectivity' source='last connectivity event' sortable sortBy='connectivity' />

        <FunctionField
          label='UUID'
          render={(record) => <CopyChip title={record['uuid']} label={record['uuid'].substring(0, 7)} />}
        />

        <Toolbar sx={{ background: 'none', padding: '0' }}>
          <ShowButton variant='outlined' label='' size='small' />
          <EditButton variant='outlined' label='' size='small' />
          <WithRecord
            render={(device) => (
              <>
                <DeviceServicesButton variant='outlined' size='small' device={device} />
                <DeviceConnectButton variant='outlined' size='small' record={device} />
              </>
            )}
          />
          <DeleteDeviceButton variant='outlined' size='small' style={{ marginRight: '0 !important' }} />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceCreate: React.FC = () => {
  const createDevice = useCreateDevice();
  const setServicesForNewDevice = useSetServicesForNewDevice();
  const redirect = useRedirect();

  const onSuccess = async (data) => {
    await setServicesForNewDevice(data);
    redirect('list', 'device', data.id);
  };

  return (
    <Create title='Create Device' transform={createDevice} mutationOptions={{ onSuccess }}>
      <SimpleForm>
        <Row>
          <TextInput
            label='UUID'
            source='uuid'
            defaultValue={uuidv4().replace(/-/g, '').toLowerCase()}
            validate={required()}
            size='large'
            readOnly={true}
          />

          <TextInput label='Device Name' source='device name' validate={required()} size='large' />
        </Row>

        <TextInput label='Note' source='note' size='large' fullWidth={true} />

        <Row>
          <ReferenceInput
            label='Device Type'
            source='is of-device type'
            reference='device type'
            target='id'
            perPage={1000}
            sort={{ field: 'slug', order: 'ASC' }}
          >
            <SelectInput optionText='slug' optionValue='id' validate={required()} size='large' />
          </ReferenceInput>

          <ReferenceInput
            label='Managed by Device'
            source='is managed by-device'
            reference='device'
            target='id'
            allowEmpty
          >
            <SelectInput optionText='device name' optionValue='id' size='large' />
          </ReferenceInput>
        </Row>

        <Row>
          <ReferenceInput
            label='Fleet'
            source='belongs to-application'
            reference='application'
            target='id'
            perPage={1000}
            sort={{ field: 'app name', order: 'ASC' }}
            filter={{ 'is of-class': 'fleet' }}
          >
            <SelectInput optionText='app name' optionValue='id' validate={required()} size='large' />
          </ReferenceInput>

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['belongs to-application'] && (
                <ReferenceInput
                  label='Target Release'
                  source={isPinnedOnRelease}
                  reference='release'
                  target='id'
                  filter={{ 'belongs to-application': formData['belongs to-application'] }}
                  allowEmpty
                >
                  <SelectInput optionText={(o) => getSemver(o)} optionValue='id' />
                </ReferenceInput>
              )
            }
          </FormDataConsumer>
        </Row>

        <SelectOperatingSystem label='Target OS' source='should be operated by-release' />
      </SimpleForm>
    </Create>
  );
};

export const DeviceEdit: React.FC = () => {
  const modifyDevice = useModifyDevice();

  return (
    <Edit title='Edit Device' actions={false} transform={modifyDevice}>
      <SimpleForm>
        <Row>
          <TextInput label='UUID' source='uuid' size='large' readOnly={true} />

          <TextInput label='Device Name' source='device name' size='large' />
        </Row>

        <TextInput label='Note' source='note' size='large' fullWidth={true} />

        <Row>
          <ReferenceInput
            label='Device Type'
            source='is of-device type'
            reference='device type'
            target='id'
            perPage={1000}
            sort={{ field: 'slug', order: 'ASC' }}
          >
            <SelectInput optionText='slug' optionValue='id' validate={required()} />
          </ReferenceInput>

          <ReferenceInput
            label='Managed by Device'
            source='is managed by-device'
            reference='device'
            target='id'
            allowEmpty
          >
            <SelectInput optionText='device name' optionValue='id' />
          </ReferenceInput>
        </Row>

        <Row>
          <ReferenceInput
            label='Fleet'
            source='belongs to-application'
            reference='application'
            target='id'
            perPage={1000}
            sort={{ field: 'app name', order: 'ASC' }}
            filter={{ 'is of-class': 'fleet' }}
          >
            <SelectInput optionText='app name' optionValue='id' validate={required()} />
          </ReferenceInput>

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['belongs to-application'] && (
                <ReferenceInput
                  label='Target Release'
                  source={isPinnedOnRelease}
                  reference='release'
                  target='id'
                  filter={{ 'belongs to-application': formData['belongs to-application'] }}
                  allowEmpty
                >
                  <SelectInput optionText={(o) => getSemver(o)} optionValue='id' />
                </ReferenceInput>
              )
            }
          </FormDataConsumer>

          <SelectOperatingSystem label='Target OS' source='should be operated by-release' />
        </Row>
      </SimpleForm>
    </Edit>
  );
};

const device = {
  list: DeviceList,
  create: DeviceCreate,
  edit: DeviceEdit,
};

export default device;
