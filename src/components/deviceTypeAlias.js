import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  List,
  ReferenceField,
  ReferenceInput,
  SelectInput,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';
import Row from '../ui/Row';

export const DeviceTypeAliasList = () => {
  return (
    <List title='Device Type Aliases'>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Device Type' source='device type' reference='device type' target='id'>
          <TextField source='slug' />
        </ReferenceField>

        <TextField label='Alias' source='is referenced by-alias' />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceTypeAliasCreate = () => (
  <Create title='Create Device Type Alias'>
    <SimpleForm
      redirect='list'
      sx={{
        '.MuiFormControl-root': {
          marginTop: '0 !important',
        },
      }}
    >
      <Row>
        <ReferenceInput
          source='device type'
          reference='device type'
          target='id'
          perPage={1000}
          sort={{ field: 'slug', order: 'ASC' }}
        >
          <SelectInput optionText='slug' optionValue='id' validate={required()} />
        </ReferenceInput>

        <TextInput label='Alias' source='is referenced by-alias' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const DeviceTypeAliasEdit = () => (
  <Edit title='Edit Device Type Alias'>
    <SimpleForm
      sx={{
        '.MuiFormControl-root': {
          marginTop: '0 !important',
        },
      }}
    >
      <Row>
        <ReferenceInput
          source='device type'
          reference='device type'
          target='id'
          perPage={1000}
          sort={{ field: 'slug', order: 'ASC' }}
        >
          <SelectInput optionText='slug' optionValue='id' validate={required()} />
        </ReferenceInput>

        <TextInput label='Alias' source='is referenced by-alias' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const deviceTypeAlias = {
  list: DeviceTypeAliasList,
  create: DeviceTypeAliasCreate,
  edit: DeviceTypeAliasEdit,
};

export default deviceTypeAlias;
