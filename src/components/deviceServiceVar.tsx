import { Box } from '@mui/material';
import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FormDataConsumer,
  FunctionField,
  List,
  ReferenceField,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
  useGetManyReference,
} from 'react-admin';
import { useCreateDeviceServiceVar, useModifyDeviceServiceVar } from '../lib/deviceServiceVar';
import CopyChip from '../ui/CopyChip';
import JsonValueInput from '../ui/JsonValueInput';
import Row from '../ui/Row';
import VarNameInput from '../ui/VarNameInput';
import SelectDevice from '../ui/SelectDevice';
import SelectDeviceService from '../ui/SelectDeviceService';

const DeviceServiceVarDatagrid: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => (
  <Datagrid
    size='medium'
    rowClick={false}
    sx={{
      '& .RaDatagrid-tableWrapper': { overflowX: 'auto' },
      '& .MuiTable-root': { minWidth: embedded ? 500 : 760, tableLayout: 'fixed' },
      '& .MuiTableCell-root': { px: embedded ? 1 : 2 },
      '& .column-name': { overflowWrap: 'anywhere' },
      '& .column-value': { width: embedded ? '34%' : '30%' },
      '& .MuiTableCell-root:last-child': { width: 92 },
    }}
  >
    {!embedded && (
      <ReferenceField label='Device' source='service install' reference='service install' target='id'>
        <ReferenceField source='device' reference='device' target='id'>
          <TextField source='device name' />
        </ReferenceField>
      </ReferenceField>
    )}

    <ReferenceField label='Service' source='service install' reference='service install' target='id' link={false}>
      <ReferenceField
        source='installs-service'
        reference='service'
        target='id'
        link={(record, reference) => `/${reference}/${record['installs-service']}`}
      >
        <TextField source='service name' />
      </ReferenceField>
    </ReferenceField>

    <TextField label='Name' source='name' />

    <FunctionField
      label='Value'
      source='value'
      render={(record) => {
        const value = String(record.value ?? '');
        const maxLength = embedded ? 24 : 40;
        const label = value.slice(0, maxLength) + (value.length > maxLength ? '...' : '');

        return (
          <Box sx={{ maxWidth: '100%', overflow: 'hidden' }}>
            <CopyChip title={value} label={label} style={{ maxWidth: '100%', whiteSpace: 'nowrap' }} />
          </Box>
        );
      }}
    />

    <Toolbar sx={{ background: 'none', p: 0, whiteSpace: 'nowrap' }}>
      <EditButton label='' size='small' variant='outlined' />
      <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
    </Toolbar>
  </Datagrid>
);

export const DeviceServiceVarList: React.FC = () => (
  <List title='Device Service Vars'>
    <DeviceServiceVarDatagrid />
  </List>
);

export const DeviceServiceVarListForDevice: React.FC<{ deviceId: string | number }> = ({ deviceId }) => {
  const { data, isLoading } = useGetManyReference('service install', {
    target: 'device',
    id: deviceId,
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  if (isLoading) {
    return null;
  }

  const serviceInstallIds = data?.map((x) => x.id) ?? [];
  const serviceInstallFilter = serviceInstallIds.length > 0 ? `(${serviceInstallIds.join(',')})` : '(null)';

  return (
    <List
      resource='device service environment variable'
      title='Device Service Vars'
      filter={{ 'service install@in': serviceInstallFilter }}
      sx={{ width: '100%', minWidth: 0 }}
    >
      <DeviceServiceVarDatagrid embedded />
    </List>
  );
};

export const DeviceServiceVarCreate: React.FC = (props) => {
  const createDeviceServiceVar = useCreateDeviceServiceVar();

  return (
    <Create title='Create Device Service Var' redirect='list' transform={createDeviceServiceVar} {...props}>
      <SimpleForm>
        <Row>
          <SelectDevice label='Device' source='device' validate={required()} />

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['device'] && (
                <SelectDeviceService
                  label='Service'
                  source='service install'
                  device={formData.device}
                  fullWidth={true}
                  validate={required()}
                />
              )
            }
          </FormDataConsumer>
        </Row>

        <VarNameInput resource='device service environment variable' validate={required()} />
        <JsonValueInput label='Value' source='value' validate={required()} />
      </SimpleForm>
    </Create>
  );
};

export const DeviceServiceVarEdit: React.FC = () => {
  const modifyDeviceServiceVar = useModifyDeviceServiceVar();

  return (
    <Edit transform={modifyDeviceServiceVar} title='Edit Device Service Var'>
      <SimpleForm>
        <Row>
          <SelectDevice label='Device' source='device' validate={required()} />

          <FormDataConsumer>
            {({ formData, ...rest }) => {
              return (
                (formData['device'] || formData['service install']) && (
                  <SelectDeviceService
                    label='Service'
                    source='service install'
                    device={formData.device || -1}
                    validate={required()}
                  />
                )
              );
            }}
          </FormDataConsumer>
        </Row>

        <VarNameInput resource='device service environment variable' validate={required()} />
        <JsonValueInput label='Value' source='value' validate={required()} />
      </SimpleForm>
    </Edit>
  );
};

const deviceServiceVar = {
  list: DeviceServiceVarList,
  create: DeviceServiceVarCreate,
  edit: DeviceServiceVarEdit,
};

export default deviceServiceVar;
