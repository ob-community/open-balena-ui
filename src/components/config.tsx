import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
} from 'react-admin';
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';

export const ConfigList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Key' source='key' />

        <FunctionField
          label='Value'
          render={(record) => (
            <CopyChip
              title={record.value}
              label={record.value.slice(0, 40) + (record.value.length > 40 ? '...' : '')}
            />
          )}
        />

        <TextField label='Scope' source='scope' />
        <TextField label='Description' source='description' />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const ConfigCreate = () => (
  <Create title='Create Config' redirect='list'>
    <SimpleForm>
      <Row>
        <TextInput label='Key' source='key' size='large' />
        <TextInput label='Value' source='value' size='large' />
      </Row>

      <Row>
        <TextInput label='Scope' source='scope' size='large' />
        <TextInput label='Description' source='description' size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const ConfigEdit = () => (
  <Edit title='Edit Config'>
    <SimpleForm>
      <Row>
        <TextInput label='Key' source='key' size='large' />
        <TextInput label='Value' source='value' size='large' />
      </Row>

      <Row>
        <TextInput label='Scope' source='scope' size='large' />
        <TextInput label='Description' source='description' size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const config = {
  list: ConfigList,
  create: ConfigCreate,
  edit: ConfigEdit,
};

export default config;
