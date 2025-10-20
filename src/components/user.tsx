import * as React from 'react';
import {
  Create,
  Datagrid,
  Edit,
  EditButton,
  email,
  EmailField,
  List,
  PasswordInput,
  ReferenceField,
  ReferenceManyField,
  SaveButton,
  SimpleForm,
  SingleFieldList,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';
import { useCreateUser, useModifyUser } from '../lib/user';
import ChangePasswordButton from '../ui/ChangePasswordButton';
import DeleteUserButton from '../ui/DeleteUserButton';
import ManageOrganizations from '../ui/ManageOrganizations';
import ManagePermissions from '../ui/ManagePermissions';
import ManageRoles from '../ui/ManageRoles';
import Row from '../ui/Row';
import PasswordChecklist from 'react-password-checklist';

const CustomBulkActionButtons = (props) => (
  <React.Fragment>
    <DeleteUserButton variant='contained' size='small' {...props}>
      Delete Selected Users
    </DeleteUserButton>
  </React.Fragment>
);

export const UserList = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={<CustomBulkActionButtons />}>
        <TextField source='username' />
        <EmailField source='email' />

        <ReferenceManyField label='Organizations' source='id' reference='organization membership' target='user'>
          <SingleFieldList linkType={false}>
            <ReferenceField source='is member of-organization' reference='organization' target='id'>
              <TextField source='name' />
            </ReferenceField>
          </SingleFieldList>
        </ReferenceManyField>

        <ReferenceManyField label='Roles' source='id' reference='user-has-role' target='user'>
          <SingleFieldList linkType={false}>
            <ReferenceField source='role' reference='role' target='id'>
              <TextField source='name' />
            </ReferenceField>
          </SingleFieldList>
        </ReferenceManyField>

        <Toolbar style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteUserButton size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

const CustomCreateToolbar = (props) => (
  <Toolbar {...props} style={{ justifyContent: 'space-between' }}>
    <SaveButton sx={{ flex: 1 }} disabled={props.saveDisabled} />
  </Toolbar>
);

export const UserCreate = (props) => {
  const createUser = useCreateUser();
  const [password, setPassword] = React.useState('');
  const [password_valid, setPasswordValid] = React.useState(false);

  return (
    <Create title='Create User' transform={createUser} {...props}>
      <SimpleForm toolbar={<CustomCreateToolbar saveDisabled={!password_valid} />}>
        <TextInput
          name='email'
          source='email'
          size='large'
          fullWidth={true}
          type='email'
          validate={[required(), email()]}
        />

        <Row>
          <TextInput name='username' source='username' validate={required()} size='large' fullWidth={true} />
          <PasswordInput
            name='password'
            source='password'
            validate={required()}
            size='large'
            fullWidth={true}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Row>

        <PasswordChecklist
          rules={['minLength', 'specialChar', 'number', 'capitalAndLowercase']}
          minLength={8}
          value={password}
          onChange={(isValid) => {
            setPasswordValid(isValid);
          }}
        />
      </SimpleForm>
    </Create>
  );
};

const CustomToolbar = (props) => {
  const { alwaysEnableSaveButton = false, ...rest } = props;
  return (
    <Toolbar {...rest} style={{ justifyContent: 'space-between' }}>
      <SaveButton alwaysEnable={alwaysEnableSaveButton} sx={{ flex: 1 }} />
      <DeleteUserButton variant='contained' size='large' sx={{ flex: 0.3, marginLeft: '40px' }}>
        Delete
      </DeleteUserButton>
    </Toolbar>
  );
};

export const UserEdit = (props) => {
  const modifyUser = useModifyUser();

  return (
    <Edit
      title='Edit User'
      transform={modifyUser}
      {...props}
      sx={{
        '> div > div': {
          maxWidth: '900px !important',
        },
      }}
    >
      <SimpleForm toolbar={<CustomToolbar />}>
        <Row>
          <TextInput name='email' source='email' size='large' type='email' validate={[required(), email()]} />
          <TextInput name='username' source='username' size='large' validate={required()} readOnly={true} />
        </Row>
        <TextInput disabled name='jwt secret' source='jwt secret' size='large' fullWidth={true} />
        <ChangePasswordButton />

        <br />

        <ManageOrganizations source='organizationArray' reference='organization membership' target='user' />
        <ManagePermissions source='permissionArray' reference='user-has-permission' target='user' />
        <ManageRoles source='roleArray' reference='user-has-role' target='user' />

        <br />
      </SimpleForm>
    </Edit>
  );
};

const userExport = {
  list: UserList,
  create: UserCreate,
  edit: UserEdit,
};

export default userExport;
