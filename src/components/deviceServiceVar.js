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
  useShowContext,
  useGetManyReference,
} from 'react-admin';
import { useCreateDeviceServiceVar, useModifyDeviceServiceVar } from '../lib/deviceServiceVar';
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';
import SelectDevice from '../ui/SelectDevice';
import SelectDeviceService from '../ui/SelectDeviceService';

export const DeviceServiceVarList = () => {
  let listProps = {
    title: 'Device Service Vars',
  };

  try {
    const showContext = useShowContext();

    const { data, isLoading, isError } = useGetManyReference('service install', {
      target: 'device',
      id: showContext.record.id,
    });

    const serviceInstallIds = data?.map((x) => x.id) || [];

    listProps = {
      resource: 'device service environment variable',
      queryOptions: !isLoading && {
        select: (res) => {
          res.data = res.data.filter((x) => serviceInstallIds.includes(x['service install']));
          return res;
        },
      },
    };
  } catch (e) {}

  return (
    <List {...listProps}>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Device' source='service install' reference='service install' target='id'>
          <ReferenceField source='device' reference='device' target='id'>
            <TextField source='device name' />
          </ReferenceField>
        </ReferenceField>

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
          render={(record) => (
            <CopyChip
              title={record.value}
              label={record.value.slice(0, 40) + (record.value.length > 40 ? '...' : '')}
            />
          )}
        />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceServiceVarCreate = (props) => {
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

        <Row>
          <TextInput label='Name' source='name' validate={required()} size='large' />
          <TextInput label='Value' source='value' validate={required()} size='large' />
        </Row>
      </SimpleForm>
    </Create>
  );
};

export const DeviceServiceVarEdit = () => {
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

        <Row>
          <TextInput label='Name' source='name' validate={required()} size='large' />
          <TextInput label='Value' source='value' validate={required()} size='large' />
        </Row>
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
