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

export const DeviceTypeAliasList: React.FC = () => {
  const { context, isPending } = useAdminAccessContext();
  if (isPending || !context) return null;
  const canManage = !context.enforcementEnabled || context.globalAdmin;

  return (
    <List title='Device Type Aliases' actions={canManage ? undefined : false}>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={canManage ? undefined : false}>
        <ReferenceField label='Device Type' source='device type' reference='device type'>
          <TextField source='slug' />
        </ReferenceField>

        <TextField label='Alias' source='is referenced by-alias' />

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

export const DeviceTypeAliasCreate: React.FC = () => (
  <Create title='Create Device Type Alias' redirect='list'>
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
  </Create>
);

export const DeviceTypeAliasEdit: React.FC = () => (
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
