import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FormDataConsumer,
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
import SemVerChip, { getSemver } from '../ui/SemVerChip';

export const ReleaseTagList = (props) => {
  return (
    <List title='Release Tags'>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Fleet' source='release' reference='release' target='id' link={false}>
          <ReferenceField
            source='belongs to-application'
            reference='application'
            target='id'
            link={(record, reference) => `/${reference}/${record.id}`}
          >
            <TextField source='app name' />
          </ReferenceField>
        </ReferenceField>

        <ReferenceField label='Release Rev.' source='release' reference='release' target='id'>
          <SemVerChip />
        </ReferenceField>

        <TextField label='Name' source='tag key' />

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

export const ReleaseTagCreate = () => {
  const processCreate = async (data) => {
    delete data.application;
    return data;
  };

  return (
    <Create title='Create Release Tag' redirect='list' transform={processCreate}>
      <SimpleForm>
        <Row>
          <ReferenceInput
            label='Fleet'
            source='application'
            reference='application'
            target='id'
            perPage={1000}
            sort={{ field: 'app name', order: 'ASC' }}
          >
            <SelectInput optionText='app name' optionValue='id' validate={required()} />
          </ReferenceInput>

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['application'] && (
                <ReferenceInput
                  label='Release'
                  source='release'
                  reference='release'
                  target='id'
                  filter={{ 'belongs to-application': formData.application }}
                  perPage={1000}
                  sort={{ field: 'revision', order: 'ASC' }}
                >
                  <SelectInput optionText={(o) => getSemver(o)} optionValue='id' validate={required()} />
                </ReferenceInput>
              )
            }
          </FormDataConsumer>
        </Row>

        <Row>
          <TextInput label='Name' source='tag key' validate={required()} size='large' />
          <TextInput label='Value' source='value' validate={required()} size='large' />
        </Row>
      </SimpleForm>
    </Create>
  );
};

export const ReleaseTagEdit = () => (
  <Edit title='Edit Release Tag'>
    <SimpleForm>
      <Row>
        <ReferenceInput
          label='Fleet'
          source='application'
          reference='application'
          target='id'
          perPage={1000}
          sort={{ field: 'app name', order: 'ASC' }}
        >
          <SelectInput optionText='app name' optionValue='id' validate={required()} />
        </ReferenceInput>

        <FormDataConsumer>
          {({ formData, ...rest }) =>
            formData['application'] && (
              <ReferenceInput
                label='Release'
                source='release'
                reference='release'
                target='id'
                filter={{ 'belongs to-application': formData.application }}
                perPage={1000}
                sort={{ field: 'revision', order: 'ASC' }}
              >
                <SelectInput optionText={(o) => getSemver(o)} optionValue='id' validate={required()} />
              </ReferenceInput>
            )
          }
        </FormDataConsumer>
      </Row>

      <Row>
        <TextInput label='Name' source='tag key' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const releaseTag = {
  list: ReleaseTagList,
  create: ReleaseTagCreate,
  edit: ReleaseTagEdit,
};

export default releaseTag;
