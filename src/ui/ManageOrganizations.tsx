import React from 'react';
import { Box } from '@mui/material';
import { AutocompleteArrayInput, Identifier, Loading, RaRecord, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';

interface OrganizationRecord extends RaRecord {
  name: string;
}

interface OrganizationMembershipRecord extends RaRecord {
  'is member of-organization': Identifier;
}

interface ManageOrganizationsProps {
  source: string;
  reference: string;
  target: string;
}

export const ManageOrganizations: React.FC<ManageOrganizationsProps> = ({ source, reference, target }) => {
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();

  const { data: organizationRecords = [], isLoading: organizationsLoading } = useGetList<OrganizationRecord>(
    'organization',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    },
  );

  const { data: membershipRecords = [], isLoading: membershipsLoading } = useGetList<OrganizationMembershipRecord>(
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
    () =>
      membershipRecords
        .map((membership) => membership['is member of-organization'])
        .filter((id): id is Identifier => id != null),
    [membershipRecords],
  );

  React.useEffect(() => {
    if (!initializedRef.current && !organizationsLoading && !membershipsLoading) {
      setValue(source, selectedIds, { shouldDirty: false });
      initializedRef.current = true;
    }
  }, [membershipsLoading, organizationsLoading, selectedIds, setValue, source]);

  const organizationChoices = React.useMemo(
    () => organizationRecords.map((organization) => ({ id: organization.id, name: organization.name })),
    [organizationRecords],
  );

  if (organizationsLoading || membershipsLoading) {
    return <Loading />;
  }

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Organizations</strong>

      <AutocompleteArrayInput
        source={source}
        choices={organizationChoices}
        label='Select organizations'
        fullWidth
        defaultValue={[]}
        sx={{ maxWidth: 360 }}
      />
    </Box>
  );
};

export default ManageOrganizations;
