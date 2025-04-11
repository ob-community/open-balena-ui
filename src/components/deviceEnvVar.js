import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  ReferenceField,
  ReferenceInput,
  SelectInput,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
  useShowContext,
} from 'react-admin';
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';

export const DeviceEnvVarList = () => {
  let listProps = {
    title: 'Device Environment Vars',
  };

  try {
    const showContext = useShowContext();
    listProps = {
      resource: 'device environment variable',
      filter: { device: showContext.record.id },
    };
  } catch (e) {}

  return (
    <List {...listProps}>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Device' source='device' reference='device' target='id'>
          <TextField source='device name' />
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

export const DeviceEnvVarCreate = () => (
  <Create title='Create Device Environment Var' redirect='list'>
    <SimpleForm>
      <ReferenceInput
        source='device'
        reference='device'
        target='id'
        perPage={1000}
        sort={{ field: 'device name', order: 'ASC' }}
      >
        <SelectInput optionText='device name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const DeviceEnvVarEdit = () => (
  <Edit title='Create Device Environment Var'>
    <SimpleForm>
      <ReferenceInput
        source='device'
        reference='device'
        target='id'
        perPage={1000}
        sort={{ field: 'device name', order: 'ASC' }}
      >
        <SelectInput optionText='device name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const deviceEnvVar = {
  list: DeviceEnvVarList,
  create: DeviceEnvVarCreate,
  edit: DeviceEnvVarEdit,
};

export default deviceEnvVar;
