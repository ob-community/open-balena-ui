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
import { useAdminAccessContext } from '../hooks/useAdminAccessContext';

export const DeviceFamilyList: React.FC = () => {
  const { context, isPending } = useAdminAccessContext();
  if (isPending || !context) return null;
  const canManage = !context.enforcementEnabled || context.globalAdmin;

  return (
    <List title='Device Families' actions={canManage ? undefined : false}>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={canManage ? undefined : false}>
        <TextField label='Slug' source='slug' />
        <TextField label='Name' source='name' />
        <ReferenceField
          label='Manufacturer'
          source='is manufactured by-device manufacturer'
          reference='device manufacturer'
          link={false}
        >
          <TextField source='name' />
        </ReferenceField>

        {canManage ? (
          <Toolbar>
            <EditButton label='' size='small' variant='outlined' />
            <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
          </Toolbar>
        ) : null}
      </Datagrid>
    </List>
  );
};

export const DeviceFamilyCreate: React.FC = () => (
  <Create title='Create Device Family' redirect='list'>
    <SimpleForm>
      <Row>
        <TextInput label='Slug' source='slug' size='large' />
        <TextInput label='Name' source='name' size='large' />
      </Row>

      <ReferenceInput
        source='is manufactured by-device manufacturer'
        reference='device manufacturer'
        target='id'
        perPage={1000}
        sort={{ field: 'name', order: 'ASC' }}
      >
        <SelectInput optionText='name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>
    </SimpleForm>
  </Create>
);

export const DeviceFamilyEdit: React.FC = () => (
  <Edit title='Edit Device Family'>
    <SimpleForm>
      <Row>
        <TextInput label='Slug' source='slug' size='large' />
        <TextInput label='Name' source='name' size='large' />
      </Row>

      <ReferenceInput
        label='Manufacturer'
        source='is manufactured by-device manufacturer'
        reference='device manufacturer'
        target='id'
        perPage={1000}
        sort={{ field: 'name', order: 'ASC' }}
      >
        <SelectInput optionText='name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>
    </SimpleForm>
  </Edit>
);

const deviceFamily = {
  list: DeviceFamilyList,
  create: DeviceFamilyCreate,
  edit: DeviceFamilyEdit,
};

export default deviceFamily;
