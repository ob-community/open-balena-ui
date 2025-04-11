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

const uniqueIssueMessage = 'This Tag is already present for this Fleet';

export const FleetTagList = () => {
  return (
    <List title='Fleet Tags'>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Fleet' source='application' reference='application' target='id'>
          <TextField source='app name' />
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

export const FleetTagCreate = () => {
  const unique = useUnique();
  return (
    <Create title='Create Fleet Tag' redirect='list'>
      <SimpleForm>
        <ReferenceInput
          label='Fleet'
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
                source='tag key'
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

export const FleetTagEdit = () => (
  <Edit title='Edit Fleet Tag'>
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
        <TextInput label='Name' source='tag key' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const fleetTag = {
  list: FleetTagList,
  create: FleetTagCreate,
  edit: FleetTagEdit,
};

export default fleetTag;
