import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  List,
  SearchInput,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';

const searchFilters = [<SearchInput key='search' source='name@ilike' alwaysOn />];

export const PermissionList: React.FC = () => {
  return (
    <List filters={searchFilters}>
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

export const PermissionCreate: React.FC = () => (
  <Create title='Create Permission'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const PermissionEdit: React.FC = () => (
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
