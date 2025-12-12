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
import JsonValueInput from '../ui/JsonValueInput';

const uniqueIssueMessage = 'This ConfigVar is already present for this Fleet';

export const FleetConfigVarList: React.FC = () => {
  return (
    <List title='Fleet Config Vars'>
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

export const FleetConfigVarCreate: React.FC = () => {
  const unique = useUnique();
  return (
    <Create title='Create Fleet Config Var' redirect='list'>
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
              fullWidth
            />
          )}
        </FormDataConsumer>
        <JsonValueInput label='Value' source='value' validate={required()} />
      </SimpleForm>
    </Create>
  );
};

export const FleetConfigVarEdit: React.FC = () => (
  <Edit title='Edit Fleet Config Var'>
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

      <TextInput label='Name' source='name' validate={required()} size='large' fullWidth />
      <JsonValueInput label='Value' source='value' validate={required()} />
    </SimpleForm>
  </Edit>
);

const fleetConfigVar = {
  list: FleetConfigVarList,
  create: FleetConfigVarCreate,
  edit: FleetConfigVarEdit,
};

export default fleetConfigVar;
