import * as React from 'react';
import {
  BooleanField,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
} from 'react-admin';
import Row from '../ui/Row';

const BooleanBinaryField = (props) => {
  return (
    <FunctionField
      {...props}
      render={(record, source) => (
        <BooleanField source='enabled' record={{ ...record, enabled: record[source] === 1 }} />
      )}
    />
  );
};

export const FleetTypeList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Slug' source='slug' />
        <TextField label='Name' source='name' />
        <TextField label='OS Version Range' source='needs-os version range' />
        <TextField label='Max Devices' source='maximum device count' />
        <TextField label='Description' source='description' />

        <BooleanBinaryField label='Web URL' source='supports web url' />

        <BooleanBinaryField label='Gateway Mode' source='supports gateway mode' />

        <BooleanBinaryField label='Payment' source='requires payment' />
        <BooleanBinaryField label='Legacy' source='is legacy' />

        <BooleanBinaryField label='Multi Container' source='supports multicontainer' />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const FleetTypeCreate = () => (
  <Create title='Create Fleet Type'>
    <SimpleForm>
      <Row>
        <TextInput source='slug' size='large' />
        <TextInput source='name' size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const FleetTypeEdit = () => (
  <Edit title='Edit Fleet Type'>
    <SimpleForm>
      <Row>
        <TextInput source='slug' size='large' />
        <TextInput source='name' size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const fleetType = {
  list: FleetTypeList,
  create: FleetTypeCreate,
  edit: FleetTypeEdit,
};

export default fleetType;
