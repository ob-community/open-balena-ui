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

export const CpuArchitectureList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Slug' source='slug' />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const CpuArchitectureCreate = () => (
  <Create title='Create CPU Architecture' redirect='list'>
    <SimpleForm>
      <Row>
        <TextInput label='Slug' source='slug' size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const CpuArchitectureEdit = () => (
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
