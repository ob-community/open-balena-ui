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

export const DeviceManufacturerList = () => {
  return (
    <List title='Device Manufacturers'>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Slug' source='slug' />
        <TextField label='Name' source='name' />
        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceManufacturerCreate = () => (
  <Create title='Create Device Manufacturer' redirect='list'>
    <SimpleForm>
      <Row>
        <TextInput label='Slug' source='slug' size='large' />
        <TextInput label='Name' source='name' size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const DeviceManufacturerEdit = () => (
  <Edit title='Edit Device Manufacturer'>
    <SimpleForm>
      <Row>
        <TextInput label='Slug' source='slug' size='large' />
        <TextInput label='Name' source='name' size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const deviceManufacturer = {
  list: DeviceManufacturerList,
  create: DeviceManufacturerCreate,
  edit: DeviceManufacturerEdit,
};

export default deviceManufacturer;
