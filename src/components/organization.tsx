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
import { useAdminAccessContext } from '../hooks/useAdminAccessContext';

export const OrganizationList: React.FC = () => {
  const { context, isPending } = useAdminAccessContext();
  if (isPending || !context) return null;
  const canEdit = !context.enforcementEnabled || context.globalAdmin || context.organizationAdmin;
  const canCreate = !context.enforcementEnabled || context.globalAdmin;

  return (
    <List actions={canCreate ? undefined : false}>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={canEdit ? undefined : false}>
        <TextField source='name' />
        <TextField source='handle' />

        <ReferenceManyField label='Fleets' source='id' reference='application' target='organization'>
          <SingleFieldList linkType={false}>
            <TextField source='app name' />
          </SingleFieldList>
        </ReferenceManyField>

        {canEdit ? (
          <Toolbar>
            <EditButton label='' size='small' variant='outlined' />
            <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
          </Toolbar>
        ) : null}
      </Datagrid>
    </List>
  );
};

export const OrganizationCreate: React.FC = () => (
  <Create title='Create Org'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
      <TextInput source='handle' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const OrganizationEdit: React.FC = () => (
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
