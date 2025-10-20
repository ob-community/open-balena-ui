import * as React from 'react';
import {
  ChipField,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
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
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';

export const ServiceLabelList = () => {
  return (
    <List title='Service Labels'>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Service' source='service' reference='service' target='id'>
          <ChipField source='service name' />
        </ReferenceField>

        <TextField label='Name' source='label name' />

        <FunctionField
          label='Value'
          render={(record) => (
            <CopyChip
              title={record.value}
              label={record.value.slice(0, 40) + (record.value.length > 40 ? '...' : '')}
            />
          )}
        />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const ServiceLabelCreate = () => (
  <Create title='Create Service Label' redirect='list'>
    <SimpleForm>
      <ReferenceInput
        source='service'
        reference='service'
        target='id'
        perPage={1000}
        sort={{ field: 'service name', order: 'ASC' }}
      >
        <SelectInput optionText='service name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='label name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const ServiceLabelEdit = () => (
  <Edit title='Edit Service Label'>
    <SimpleForm>
      <ReferenceInput
        source='service'
        reference='service'
        target='id'
        perPage={1000}
        sort={{ field: 'service name', order: 'ASC' }}
      >
        <SelectInput optionText='service name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='label name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const serviceLabel = {
  list: ServiceLabelList,
  create: ServiceLabelCreate,
  edit: ServiceLabelEdit,
};

export default serviceLabel;
