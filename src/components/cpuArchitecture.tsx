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
} from 'react-admin';
import Row from '../ui/Row';
import { useAdminAccessContext } from '../hooks/useAdminAccessContext';

export const CpuArchitectureList: React.FC = () => {
  const { context, isPending } = useAdminAccessContext();
  if (isPending || !context) return null;
  const canManage = !context.enforcementEnabled || context.globalAdmin;

  return (
    <List actions={canManage ? undefined : false}>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={canManage ? undefined : false}>
        <TextField label='Slug' source='slug' />

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

export const CpuArchitectureCreate: React.FC = () => (
  <Create title='Create CPU Architecture' redirect='list'>
    <SimpleForm>
      <Row>
        <TextInput label='Slug' source='slug' size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const CpuArchitectureEdit: React.FC = () => (
  <Edit title='Edit CPU Architecture'>
    <SimpleForm>
      <Row>
        <TextInput label='ID' source='id' disabled={true} size='large' />
        <TextInput label='Slug' source='slug' size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const cpuArchitecture = {
  list: CpuArchitectureList,
  create: CpuArchitectureCreate,
  edit: CpuArchitectureEdit,
};

export default cpuArchitecture;
