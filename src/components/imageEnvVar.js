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

export const ImageEnvVarList = () => {
  return (
    <List title='Image Environment Vars'>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Image' source='release image' />

        <ReferenceField label='Service' source='release image' reference='image' target='id' link={false}>
          <ReferenceField source='is a build of-service' reference='service' target='id' link={false}>
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

        <TextField label='Name' source='name' />

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

export const ImageEnvVarCreate = () => (
  <Create title='Create Image Environment Var' redirect='list'>
    <SimpleForm>
      <ReferenceInput source='release image' reference='image' target='id'>
        <SelectInput optionText='id' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const ImageEnvVarEdit = () => (
  <Edit title='Edit Image Environment Var'>
    <SimpleForm>
      <ReferenceInput source='release image' reference='image' target='id'>
        <SelectInput optionText='id' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const imageEnvVar = {
  list: ImageEnvVarList,
  create: ImageEnvVarCreate,
  edit: ImageEnvVarEdit,
};

export default imageEnvVar;
