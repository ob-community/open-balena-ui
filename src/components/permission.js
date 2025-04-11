import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  List,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';

export const PermissionList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <TextField source='name' />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const PermissionCreate = () => (
  <Create title='Create Permission'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const PermissionEdit = () => (
  <Edit title='Edit Permission'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Edit>
);

const permission = {
  list: PermissionList,
  create: PermissionCreate,
  edit: PermissionEdit,
};

export default permission;
