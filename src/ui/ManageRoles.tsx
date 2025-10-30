import React from 'react';
import { Box } from '@mui/material';
import { AutocompleteArrayInput, Identifier, Loading, RaRecord, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';

interface RoleRecord extends RaRecord {
  name: string;
}

interface RoleAssignmentRecord extends RaRecord {
  role: Identifier;
}

interface ManageRolesProps {
  source: string;
  reference: string;
  target: string;
}

export const ManageRoles: React.FC<ManageRolesProps> = ({ source, reference, target }) => {
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();

  const { data: roleRecords = [], isLoading: rolesLoading } = useGetList<RoleRecord>('role', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  const { data: assignmentRecords = [], isLoading: assignmentsLoading } = useGetList<RoleAssignmentRecord>(
    reference,
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: record?.id ? { [target]: record.id } : {},
    },
    {
      enabled: Boolean(record?.id),
    },
  );

  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    initializedRef.current = false;
  }, [record?.id]);

  const selectedIds = React.useMemo<Identifier[]>(
    () => assignmentRecords.map((assignment) => assignment.role).filter((id): id is Identifier => id != null),
    [assignmentRecords],
  );

  React.useEffect(() => {
    if (!initializedRef.current && !rolesLoading && !assignmentsLoading) {
      setValue(source, selectedIds, { shouldDirty: false });
      initializedRef.current = true;
    }
  }, [assignmentsLoading, rolesLoading, selectedIds, setValue, source]);

  const roleChoices = React.useMemo(() => roleRecords.map((role) => ({ id: role.id, name: role.name })), [roleRecords]);

  if (rolesLoading || assignmentsLoading) {
    return <Loading />;
  }

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Roles</strong>

      <AutocompleteArrayInput
        source={source}
        choices={roleChoices}
        label='Select roles'
        fullWidth
        defaultValue={[]}
        sx={{ maxWidth: 360 }}
      />
    </Box>
  );
};

export default ManageRoles;
