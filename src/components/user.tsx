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
  ToolbarProps,
  CreateProps,
  EditProps,
} from 'react-admin';
import { useModifyUser } from '../lib/user';
import ChangePasswordButton from '../ui/ChangePasswordButton';
import DeleteUserButton, { DeleteUserButtonProps } from '../ui/DeleteUserButton';
import ManageOrganizations from '../ui/ManageOrganizations';
import ManagePermissions from '../ui/ManagePermissions';
import ManageRoles from '../ui/ManageRoles';
import Row from '../ui/Row';
import PasswordChecklist from 'react-password-checklist';
import { isPasswordWithinBcryptLimit, maxPasswordBytes } from '../lib/passwordPolicy';
import { useAdminAccessContext } from '../hooks/useAdminAccessContext';

const CustomBulkActionButtons: React.FC<DeleteUserButtonProps> = (props) => (
  <React.Fragment>
    <DeleteUserButton variant='contained' size='small' {...props}>
      Delete Selected Users
    </DeleteUserButton>
  </React.Fragment>
);

export const UserList: React.FC = () => {
  const { context, isPending } = useAdminAccessContext();
  if (isPending || !context) return null;
  const canEdit = !context.enforcementEnabled || context.globalAdmin || context.organizationAdmin;
  const canCreate = !context.enforcementEnabled || context.globalAdmin;
  const canDelete = canCreate;
  const canAccessGlobalResources = canCreate;

  return (
    <List actions={canCreate ? undefined : false}>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={canDelete ? <CustomBulkActionButtons /> : false}>
        <TextField source='username' />
        <EmailField source='email' />

        <ReferenceManyField label='Organizations' source='id' reference='organization membership' target='user'>
          <SingleFieldList linkType={false}>
            <ReferenceField
              source='is member of-organization'
              reference='organization'
              link={canEdit ? undefined : false}
            >
              <TextField source='name' />
            </ReferenceField>
          </SingleFieldList>
        </ReferenceManyField>

        <ReferenceManyField label='Roles' source='id' reference='user-has-role' target='user'>
          <SingleFieldList linkType={false}>
            <ReferenceField source='role' reference='role' link={canAccessGlobalResources ? undefined : false}>
              <TextField source='name' />
            </ReferenceField>
          </SingleFieldList>
        </ReferenceManyField>

        {canEdit ? (
          <Toolbar style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}>
            <EditButton label='' size='small' variant='outlined' />
            {canDelete ? <DeleteUserButton size='small' variant='outlined' /> : null}
          </Toolbar>
        ) : null}
      </Datagrid>
    </List>
  );
};

const CustomCreateToolbar: React.FC<ToolbarProps & { saveDisabled?: boolean }> = ({ saveDisabled, ...props }) => (
  <Toolbar {...props} style={{ justifyContent: 'space-between' }}>
    <SaveButton sx={{ flex: 1 }} disabled={saveDisabled} />
  </Toolbar>
);

export const UserCreate: React.FC<CreateProps> = (props) => {
  const [password, setPassword] = React.useState('');
  const [passwordChecklistValid, setPasswordChecklistValid] = React.useState(false);
  const passwordValid = passwordChecklistValid && isPasswordWithinBcryptLimit(password);

  return (
    <Create title='Create User' {...props}>
      <SimpleForm toolbar={<CustomCreateToolbar saveDisabled={!passwordValid} />}>
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
            validate={[required(), maxPasswordBytes]}
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
            setPasswordChecklistValid(isValid);
          }}
        />
      </SimpleForm>
    </Create>
  );
};

const CustomToolbar: React.FC<ToolbarProps & { alwaysEnableSaveButton?: boolean }> = ({
  alwaysEnableSaveButton,
  ...props
}) => (
  <Toolbar {...props} style={{ justifyContent: 'space-between' }}>
    <SaveButton alwaysEnable={alwaysEnableSaveButton} sx={{ flex: 1 }} />
    <DeleteUserButton variant='contained' size='large' sx={{ flex: 0.3, marginLeft: '40px' }}>
      Delete
    </DeleteUserButton>
  </Toolbar>
);

export const UserEdit: React.FC<EditProps> = (props) => {
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
