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
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';
import CopyChip from '../ui/CopyChip';
import ReleaseImageInput from '../ui/ReleaseImageInput';
import Row from '../ui/Row';
import SemVerChip from '../ui/SemVerChip';

export const ImageLabelList: React.FC = () => {
  return (
    <List title='Image Labels'>
      <Datagrid size='medium' rowClick={false}>
        <TextField label='Release Image' source='release image' />

        <ReferenceField label='Service' source='release image' reference='image-is part of-release' link={false}>
          <ReferenceField source='image' reference='image' link={false}>
            <ReferenceField source='is a build of-service' reference='service' link={false}>
              <TextField source='service name' />
            </ReferenceField>
          </ReferenceField>
        </ReferenceField>

        <ReferenceField label='Release Rev.' source='release image' reference='image-is part of-release' link={false}>
          <ReferenceField source='is part of-release' reference='release' link={false}>
            <SemVerChip />
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

export const ImageLabelCreate: React.FC = () => (
  <Create title='Create Image Label' redirect='list'>
    <SimpleForm>
      <ReleaseImageInput />

      <Row>
        <TextInput label='Name' source='label name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const ImageLabelEdit: React.FC = () => (
  <Edit title='Edit Image Label'>
    <SimpleForm>
      <ReleaseImageInput />

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
