import { Tooltip, useTheme } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { Done, Warning, WarningAmber } from '@mui/icons-material';
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

// Get the proper field name for isPinnedOnRelease based on API version
const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

export const OnlineField: React.FC<Omit<FunctionFieldProps<any>, 'render'>> = (props) => {
  const theme = useTheme();

  return (
    <FunctionField
      {...props}
      render={(record, source) => {
        if (!source) {
          return null;
        }
        const isOnline = record[source] === 'online';

        return (
          <Tooltip
            placement='top'
            arrow={true}
            title={'Since ' + dateFormat(new Date(record['last connectivity event']))}
          >
            <strong style={{ color: isOnline ? theme.palette.success.light : theme.palette.error.light }}>
              {isOnline ? 'Online' : 'Offline'}
            </strong>
          </Tooltip>
        );
      }}
    />
  );
};

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

  const augmentedRecord =
    targetReleaseId !== undefined && targetReleaseId !== record['should be running-release']
      ? { ...record, ['should be running-release']: targetReleaseId }
      : record;

  const isTrackingLatest = origin === 'latest';
  const currentRelease = record[source];
  const hasTarget = targetReleaseId !== undefined && targetReleaseId !== null;
  const isTargetMatch =
    hasTarget && currentRelease !== undefined && currentRelease !== null
      ? String(currentRelease) === String(targetReleaseId)
      : false;

  const isUpToDate = hasTarget ? isTargetMatch : isTrackingLatest;
  const isOnline = record['api heartbeat state'] === 'online';
  const chipIcon = isUpToDate && hasTarget ? <TargetReleaseIcon origin={origin} fontSize='small' /> : undefined;

  return (
    <RecordContextProvider value={augmentedRecord}>
      <ReferenceField label='Current Release' source='is running-release' reference='release' target='id'>
        <SemVerChip icon={chipIcon} sx={{ position: 'relative', top: '-5px' }} withTooltip={false} />
      </ReferenceField>

      {record[source] &&
        (targetReleaseId !== undefined && targetReleaseId !== null ? (
          <ReferenceField reference='release' target='id' source='should be running-release' link={false}>
            <TargetReleaseTooltip origin={origin}>
              <span
                style={{
                  position: 'relative',
                  top: '3px',
                  left: '3px',
                  color: !isUpToDate && isOnline ? theme.palette.error.light : theme.palette.text.primary,
                }}
              >
                {isUpToDate ? <Done /> : isOnline ? <Warning /> : <WarningAmber />}
              </span>
            </TargetReleaseTooltip>
          </ReferenceField>
        ) : (
          <TargetReleaseTooltip origin={origin} fallbackDetail='Tracking latest release'>
            <span
              style={{
                position: 'relative',
                top: '3px',
                left: '3px',
                color: !isUpToDate && isOnline ? theme.palette.error.light : theme.palette.text.primary,
              }}
            >
              {isUpToDate ? <Done /> : isOnline ? <Warning /> : <WarningAmber />}
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
        fontSize: 0,
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
    <List {...props} filters={deviceFilters} actions={<DeviceListActions />} pagination={<ExtendedPagination />}>
      <Datagrid rowClick={false} bulkActionButtons={<CustomBulkActionButtons />} size='medium'>
        <ReferenceField label='Name' source='id' reference='device' target='id' link='show'>
          <TextField source='device name' />
        </ReferenceField>

        <OnlineField label='Status' source='api heartbeat state' />

        <ReleaseField label='Current Release' source='is running-release' />

        <ReferenceField label='Device Type' source='is of-device type' reference='device type' target='id' link={false}>
          <TextField source='slug' />
        </ReferenceField>

        <ReferenceField label='Fleet' source='belongs to-application' reference='application' target='id'>
          <TextField source='app name' />
        </ReferenceField>

        <FunctionField
          label='OS'
          render={(record) =>
            record['os version'] && record['os variant'] ? `${record['os version']}-${record['os variant']}` : ''
          }
        />

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
