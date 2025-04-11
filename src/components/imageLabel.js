import * as React from 'react';
import {
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
import SemVerChip from '../ui/SemVerChip';

export const ImageLabelList = () => {
  return (
    <List title='Image Labels'>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Image' source='release image' />

        <ReferenceField label='Service' source='release image' reference='image' target='id' link={false}>
          <ReferenceField label='Service' source='is a build of-service' reference='service' target='id' link={false}>
            <TextField source='service name' />
          </ReferenceField>
        </ReferenceField>

        <ReferenceField label='Release Rev.' source='release image' reference='image' target='id' link={false}>
          <ReferenceField source='id' reference='image-is part of-release' target='image' link={false}>
            <ReferenceField source='is part of-release' reference='release' link={false}>
              <SemVerChip />
            </ReferenceField>
          </ReferenceField>
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

export const ImageLabelCreate = () => (
  <Create title='Create Image Label' redirect='list'>
    <SimpleForm>
      <ReferenceInput
        source='release image'
        reference='image'
        target='id'
        perPage={1000}
        sort={{ field: 'id', order: 'ASC' }}
      >
        <SelectInput optionText='id' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='label name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const ImageLabelEdit = () => (
  <Edit title='Edit Image Label'>
    <SimpleForm>
      <ReferenceInput
        source='release image'
        reference='image'
        target='id'
        perPage={1000}
        sort={{ field: 'id', order: 'ASC' }}
      >
        <SelectInput optionText='id' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='label name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const imageLabel = {
  list: ImageLabelList,
  create: ImageLabelCreate,
  edit: ImageLabelEdit,
};

export default imageLabel;
