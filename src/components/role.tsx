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
import { useModifyRole } from '../lib/role';
import ManagePermissions from '../ui/ManagePermissions';

export const RoleList = () => {
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

export const RoleCreate = () => (
  <Create title='Create Role'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const RoleEdit = () => {
  const modifyRole = useModifyRole();

  return (
    <Edit
      title='Edit Role'
      transform={modifyRole}
      sx={{
        '> div > div': {
          maxWidth: '900px !important',
        },
      }}
    >
      <SimpleForm toolbar={<Toolbar />}>
        <TextInput source='name' validate={required()} size='large' fullWidth={true} />

        <ManagePermissions source='permissionArray' reference='role-has-permission' target='role' />

        <br />
      </SimpleForm>
    </Edit>
  );
};

const role = {
  list: RoleList,
  create: RoleCreate,
  edit: RoleEdit,
};

export default role;
