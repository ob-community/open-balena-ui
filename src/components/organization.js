import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  List,
  ReferenceManyField,
  SimpleForm,
  SingleFieldList,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';

export const OrganizationList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <TextField source='name' />
        <TextField source='handle' />

        <ReferenceManyField label='Fleets' source='id' reference='application' target='organization'>
          <SingleFieldList linkType={false}>
            <TextField source='app name' />
          </SingleFieldList>
        </ReferenceManyField>

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const OrganizationCreate = () => (
  <Create title='Create Org'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
      <TextInput source='handle' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const OrganizationEdit = () => (
  <Edit title='Edit Org'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
      <TextInput source='handle' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Edit>
);

const organization = {
  list: OrganizationList,
  create: OrganizationCreate,
  edit: OrganizationEdit,
};

export default organization;
