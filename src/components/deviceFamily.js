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

export const DeviceFamilyList = () => {
  return (
    <List title='Device Families'>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Slug' source='slug' />
        <TextField label='Name' source='name' />
        <ReferenceField
          label='Manufacturer'
          source='is manufactured by-device manufacturer'
          reference='device manufacturer'
          target='id'
          link={false}
        >
          <TextField source='name' />
        </ReferenceField>

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceFamilyCreate = () => (
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

export const DeviceFamilyEdit = () => (
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
