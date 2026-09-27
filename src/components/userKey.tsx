import * as React from 'react';
import { Alert, Stack } from '@mui/material';
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
  useDataProvider,
  useGetIdentity,
  useNotify,
  useRecordContext,
  required,
  type RaRecord,
} from 'react-admin';
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';

interface AdminAccessContext {
  enforcementEnabled: boolean;
  globalAdmin: boolean;
  organizationAdmin: boolean;
  userId: number;
}

const useAdminAccessContext = (): AdminAccessContext | undefined => {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const notify = useNotify();
  const [context, setContext] = React.useState<AdminAccessContext>();

  React.useEffect(() => {
    const controller = new AbortController();
    dataProvider
      .getAdminAccessContext({ signal: controller.signal })
      .then(setContext)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          notify(error instanceof Error ? error.message : 'Unable to determine administrator access.', {
            type: 'error',
          });
        }
      });
    return () => controller.abort();
  }, [dataProvider, notify]);

  return context;
};

export const canManageUserKey = (record: RaRecord | undefined): boolean => typeof record?.['public key'] === 'string';
export const canManageAllUserKeys = (context: AdminAccessContext): boolean =>
  !context.enforcementEnabled || context.globalAdmin;

const UserKeyActions: React.FC = () => {
  const record = useRecordContext();

  if (!canManageUserKey(record)) {
    return <>Read only</>;
  }

  return (
    <Stack direction='row' spacing={1}>
      <EditButton label='' variant='outlined' size='small' />
      <DeleteButton mutationMode='pessimistic' label='' variant='outlined' size='small' />
    </Stack>
  );
};

export const UserKeysList: React.FC = () => {
  return (
    <List>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='User' source='user' reference='user'>
          <TextField source='username' />
        </ReferenceField>

        <TextField label='Key Name' source='title' />

        <FunctionField
          render={(record) => {
            const publicKey = record['public key'];
            return typeof publicKey === 'string' ? (
              <CopyChip title={publicKey} label={`${publicKey.slice(0, 70)}...`} />
            ) : (
              'Hidden'
            );
          }}
        />

        <FunctionField label='Actions' render={() => <UserKeyActions />} />
      </Datagrid>
    </List>
  );
};

const formStyles = {
  '.MuiFormControl-root': {
    marginTop: '0',
  },
  '.MuiFormHelperText-root': {
    display: 'none',
  },
};

const UserKeyOwnerInput: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => (
  <ReferenceInput source='user' reference='user' target='id' perPage={1000} sort={{ field: 'username', order: 'ASC' }}>
    <SelectInput
      optionText='username'
      optionValue='id'
      validate={required()}
      fullWidth={true}
      variant='outlined'
      disabled={disabled}
    />
  </ReferenceInput>
);

export const UserKeysCreate: React.FC = () => {
  const { data: identity, isPending } = useGetIdentity();
  const accessContext = useAdminAccessContext();
  if (isPending || !identity || !accessContext) {
    return null;
  }
  const canManageAllKeys = canManageAllUserKeys(accessContext);

  return (
    <Create
      title='Create SSH Key'
      redirect='list'
      transform={(data) => ({ ...data, user: canManageAllKeys ? data.user : identity.id })}
    >
      <SimpleForm sx={formStyles} defaultValues={{ user: identity.id }}>
        <Row>
          <UserKeyOwnerInput disabled={!canManageAllKeys} />
          <TextInput label='Title' source='title' validate={required()} size='large' />
        </Row>

        <br />
        <TextInput multiline label='Key' source='public key' validate={required()} size='large' fullWidth={true} />
      </SimpleForm>
    </Create>
  );
};

const UserKeyEditForm: React.FC = () => {
  const record = useRecordContext();
  if (!record) {
    return null;
  }
  if (!canManageUserKey(record)) {
    return <Alert severity='warning'>You can only edit your own SSH keys.</Alert>;
  }

  return (
    <SimpleForm sx={formStyles}>
      <Row>
        <UserKeyOwnerInput disabled />
        <TextInput label='Title' source='title' validate={required()} size='large' />
      </Row>

      <br />
      <TextInput label='Key' source='public key' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  );
};

export const UserKeysEdit: React.FC = () => (
  <Edit title='Edit SSH Key'>
    <UserKeyEditForm />
  </Edit>
);

const userKey = {
  list: UserKeysList,
  create: UserKeysCreate,
  edit: UserKeysEdit,
};

export default userKey;
