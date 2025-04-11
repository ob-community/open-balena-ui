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

export const DeviceConfigVarList = () => {
  let listProps = {
    title: 'Device Config Vars',
  };

  try {
    const showContext = useShowContext();
    listProps = {
      resource: 'device config variable',
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
              label={record.value?.slice(0, 40) + (record.value?.length > 40 ? '...' : '')}
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

export const DeviceConfigVarCreate = () => (
  <Create title='Create Device Config Var' redirect='list'>
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
        <TextInput label='Name' source='name' size='large' />
        <TextInput label='Value' source='value' size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const DeviceConfigVarEdit = () => (
  <Edit title='Edit Device Config Var'>
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
        <TextInput label='Name' source='name' size='large' />
        <TextInput label='Value' source='value' size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const deviceConfigVar = {
  list: DeviceConfigVarList,
  create: DeviceConfigVarCreate,
  edit: DeviceConfigVarEdit,
};

export default deviceConfigVar;
