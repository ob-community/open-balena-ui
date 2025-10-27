import React from 'react';
import { Box } from '@mui/material';
import { Identifier, Loading, RaRecord, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';
import GenericTransferList, { TransferListOption } from '../components/genericTransferList';

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
  const [selection, setSelection] = React.useState<Identifier[]>([]);

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
    setSelection([]);
  }, [record?.id]);

  const selectedIds = React.useMemo<Identifier[]>(
    () => assignmentRecords.map((assignment) => assignment.role).filter((id): id is Identifier => id != null),
    [assignmentRecords],
  );

  React.useEffect(() => {
    if (!initializedRef.current && !rolesLoading && !assignmentsLoading) {
      setSelection(selectedIds);
      setValue(source, selectedIds, { shouldDirty: false });
      initializedRef.current = true;
    }
  }, [assignmentsLoading, rolesLoading, selectedIds, setValue, source]);

  const roleOptions = React.useMemo<TransferListOption[]>(
    () => roleRecords.map((role) => ({ id: role.id, label: role.name })),
    [roleRecords],
  );

  const handleSelectionChange = React.useCallback(
    (nextIds: Identifier[]) => {
      setSelection(nextIds);
      setValue(source, nextIds, { shouldDirty: true });
    },
    [setValue, source],
  );

  if (rolesLoading || assignmentsLoading) {
    return <Loading />;
  }

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Roles</strong>

      <GenericTransferList
        options={roleOptions}
        value={selection}
        onChange={handleSelectionChange}
        availableLabel='Available'
        selectedLabel='Selected'
        listWidth={320}
        listHeight={360}
      />
    </Box>
  );
};

export default ManageRoles;
