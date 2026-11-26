import * as React from 'react';
import {
  AutocompleteInput,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  ReferenceField,
  ReferenceInput,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
  useShowContext,
} from 'react-admin';
import CopyChip from '../ui/CopyChip';
import JsonValueInput from '../ui/JsonValueInput';
import { ReturnListActions, useReturnState, useReturnTo } from '../ui/returnTo';
import VarNameInput from '../ui/VarNameInput';

export const DeviceEnvVarList: React.FC = () => {
  let listProps: Record<string, unknown> = {
    title: 'Device Environment Vars',
  };

  try {
    const showContext = useShowContext();
    listProps = {
      resource: 'device environment variable',
      filter: { device: showContext.record.id },
      actions: <ReturnListActions record={{ device: showContext.record.id }} />,
    };
  } catch (e) {}

  return (
    <List actions={<ReturnListActions />} {...listProps}>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Device' source='device' reference='device'>
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
          <EditButton label='' size='small' variant='outlined' state={useReturnState()} />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' redirect={false} />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceEnvVarCreate: React.FC = () => (
  <Create title='Create Device Environment Var' redirect={useReturnTo()}>
    <SimpleForm>
      <ReferenceInput
        source='device'
        reference='device'
        target='id'
        perPage={1000}
        sort={{ field: 'device name', order: 'ASC' }}
      >
        <AutocompleteInput
          optionText='device name'
          optionValue='id'
          validate={required()}
          fullWidth={true}
          filterToQuery={(searchText) => ({ 'device name@ilike': searchText })}
        />
      </ReferenceInput>
      <VarNameInput resource='device environment variable' validate={required()} />
      <JsonValueInput label='Value' source='value' validate={required()} />
    </SimpleForm>
  </Create>
);

export const DeviceEnvVarEdit: React.FC = () => (
  <Edit redirect={useReturnTo()} title='Edit Device Environment Var'>
    <SimpleForm>
      <ReferenceInput
        source='device'
        reference='device'
        target='id'
        perPage={1000}
        sort={{ field: 'device name', order: 'ASC' }}
      >
        <AutocompleteInput
          optionText='device name'
          optionValue='id'
          validate={required()}
          fullWidth={true}
          filterToQuery={(searchText) => ({ 'device name@ilike': searchText })}
        />
      </ReferenceInput>

      <VarNameInput resource='device environment variable' validate={required()} />
      <JsonValueInput label='Value' source='value' validate={required()} />
    </SimpleForm>
  </Edit>
);

const deviceEnvVar = {
  list: DeviceEnvVarList,
  create: DeviceEnvVarCreate,
  edit: DeviceEnvVarEdit,
};

export default deviceEnvVar;
