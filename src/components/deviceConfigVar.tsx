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
import JsonValueInput from '../ui/JsonValueInput';
import VarNameInput from '../ui/VarNameInput';

export const DeviceConfigVarList: React.FC = () => {
  let listProps: Record<string, unknown> = {
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

export const DeviceConfigVarCreate: React.FC = () => (
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

      <VarNameInput resource='device config variable' />
      <JsonValueInput label='Value' source='value' />
    </SimpleForm>
  </Create>
);

export const DeviceConfigVarEdit: React.FC = () => (
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

      <VarNameInput resource='device config variable' />
      <JsonValueInput label='Value' source='value' />
    </SimpleForm>
  </Edit>
);

const deviceConfigVar = {
  list: DeviceConfigVarList,
  create: DeviceConfigVarCreate,
  edit: DeviceConfigVarEdit,
};

export default deviceConfigVar;
