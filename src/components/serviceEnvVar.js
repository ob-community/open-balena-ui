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

export const ServiceEnvVarList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Fleet' source='service' reference='service' target='id'>
          <ReferenceField source='application' reference='application' target='id'>
            <TextField source='app name' />
          </ReferenceField>
        </ReferenceField>

        <ReferenceField label='Service' source='service' reference='service' target='id'>
          <TextField source='service name' />
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

export const ServiceEnvVarCreate = (props) => {
  const processCreate = async (data) => {
    delete data.application;
    return data;
  };

  return (
    <Create title='Create Service Environment Var' redirect='list' transform={processCreate} {...props}>
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
            <SelectInput optionText='app name' optionValue='id' validate={required()} fullWidth={true} />
          </ReferenceInput>

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['application'] && (
                <ReferenceInput
                  label='Service'
                  source='service'
                  reference='service'
                  target='id'
                  filter={{ application: formData.application }}
                  perPage={1000}
                  sort={{ field: 'service name', order: 'ASC' }}
                >
                  <SelectInput optionText='service name' optionValue='id' validate={required()} />
                </ReferenceInput>
              )
            }
          </FormDataConsumer>
        </Row>

        <Row>
          <TextInput label='Name' source='name' validate={required()} size='large' />
          <TextInput label='Value' source='value' validate={required()} size='large' />
        </Row>
      </SimpleForm>
    </Create>
  );
};

export const ServiceEnvVarEdit = () => (
  <Edit title='Edit Service Environment Var'>
    <SimpleForm>
      <Row>
        <TextInput label='Name' source='name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const serviceEnvVar = {
  list: ServiceEnvVarList,
  create: ServiceEnvVarCreate,
  edit: ServiceEnvVarEdit,
};

export default serviceEnvVar;
