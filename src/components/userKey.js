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

export const UserKeysList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='User' source='user' reference='user' target='id'>
          <TextField source='username' />
        </ReferenceField>

        <TextField label='Key Name' source='title' />

        <FunctionField
          render={(record) => (
            <CopyChip title={record['public key']} label={record['public key'].slice(0, 70) + '...'} />
          )}
        />

        <Toolbar>
          <EditButton label='' variant='outlined' size='small' />
          <DeleteButton mutationMode='optimistic' label='' variant='outlined' size='small' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const UserKeysCreate = () => (
  <Create title='Create SSH Key'>
    <SimpleForm
      redirect='list'
      sx={{
        '.MuiFormControl-root': {
          marginTop: '0',
        },
        '.MuiFormHelperText-root': {
          display: 'none',
        },
      }}
    >
      <Row>
        <ReferenceInput
          source='user'
          reference='user'
          target='id'
          perPage={1000}
          sort={{ field: 'username', order: 'ASC' }}
        >
          <SelectInput
            optionText='username'
            optionValue='id'
            validate={required()}
            fullWidth={true}
            variant='outlined'
          />
        </ReferenceInput>
        <TextInput label='Title' source='title' validate={required()} size='large' />
      </Row>

      <br />
      <TextInput multiline label='Key' source='public key' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const UserKeysEdit = () => (
  <Edit title='Edit SSH Key'>
    <SimpleForm
      sx={{
        '.MuiFormControl-root': {
          marginTop: '0',
        },
        '.MuiFormHelperText-root': {
          display: 'none',
        },
      }}
    >
      <Row>
        <ReferenceInput
          source='user'
          reference='user'
          target='id'
          perPage={1000}
          sort={{ field: 'username', order: 'ASC' }}
        >
          <SelectInput optionText='username' optionValue='id' validate={required()} size='large' />
        </ReferenceInput>

        <TextInput label='Title' source='title' validate={required()} size='large' />
      </Row>

      <br />

      <TextInput label='Key' source='public key' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Edit>
);

const userKey = {
  list: UserKeysList,
  create: UserKeysCreate,
  edit: UserKeysEdit,
};

export default userKey;
