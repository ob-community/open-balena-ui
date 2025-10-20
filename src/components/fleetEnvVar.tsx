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
  useUnique,
} from 'react-admin';
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';

const uniqueIssueMessage = 'This EnvironmentVar is already present for this Fleet';

export const FleetEnvVarList = () => {
  return (
    <List title='Fleet Environment Variables'>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Fleet' source='application' reference='application' target='id'>
          <TextField source='app name' />
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

export const FleetEnvVarCreate = () => {
  const unique = useUnique();
  return (
    <Create title='Create Fleet Environment Variable' redirect='list'>
      <SimpleForm>
        <ReferenceInput
          source='application'
          reference='application'
          target='id'
          perPage={1000}
          sort={{ field: 'app name', order: 'ASC' }}
        >
          <SelectInput
            label='Fleet name'
            optionText='app name'
            optionValue='id'
            validate={required()}
            fullWidth={true}
          />
        </ReferenceInput>

        <Row>
          <FormDataConsumer>
            {({ formData }) => (
              <TextInput
                label='Name'
                source='name'
                validate={[
                  required(),
                  unique({
                    filter: {
                      application: formData.application,
                    },
                    message: uniqueIssueMessage,
                  }),
                ]}
                size='large'
              />
            )}
          </FormDataConsumer>
          <TextInput label='Value' source='value' validate={required()} size='large' />
        </Row>
      </SimpleForm>
    </Create>
  );
};

export const FleetEnvVarEdit = () => (
  <Edit title='Edit Fleet Environment Variable'>
    <SimpleForm>
      <ReferenceInput
        source='application'
        reference='application'
        target='id'
        perPage={1000}
        sort={{ field: 'app name', order: 'ASC' }}
      >
        <SelectInput label='Fleet name' optionText='app name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='name' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const fleetEnvVar = {
  list: FleetEnvVarList,
  create: FleetEnvVarCreate,
  edit: FleetEnvVarEdit,
};

export default fleetEnvVar;
