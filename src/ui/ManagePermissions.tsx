import React from 'react';
import { Box } from '@mui/material';
import { AutocompleteArrayInput, Identifier, Loading, RaRecord, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';

const decode: Record<string, string> = {
  'actor eq @__ACTOR_ID': 'self',
  'id eq @__ACTOR_ID': 'self',
  'is_of__actor eq @__ACTOR_ID': 'self',
  'application/canAccess()': 'app accessible',
  'device/any(d:d/actor eq @__ACTOR_ID)': 'device accessible',
  'device/canAccess()': 'device accessible',
  'describes__device/canAccess()': 'device accessible',
  'service_install/canAccess()': 'service accessible',
  'service_install/any(si:si/device/any(d:d/actor eq @__ACTOR_ID))': 'service accessible',
  'service/canAccess()': 'service accessible',
  'image/any(i:i/is_a_build_of__service/any(s:s/application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID)) or a/owns__device/any(d:d/is_managed_by__device/any(md:md/actor eq @__ACTOR_ID)))))':
    'image accessible',
  'device/any(d:d/actor eq @__ACTOR_ID or d/is_managed_by__device/any(md:md/actor eq @__ACTOR_ID)) and installs__image/any(i:i/image__is_part_of__release/any(ipr:ipr/is_part_of__release/any(r:r/belongs_to__application/any(a:a/owns__device/any(d:d/actor eq @__ACTOR_ID) or a/is_public eq true or a/is_host eq true))))':
    'device accessible',
  'image/canAccess()': 'image accessible',
  'device/any(d:d/actor eq @__ACTOR_ID or d/belongs_to__application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID))))':
    'device accessible',
  'is_part_of__release/canAccess()': 'release accessible',
  'release_image/canAccess()': 'release accessible',
  'release/canAccess()': 'release accessible',
  'user/any(u:u/actor eq @__ACTOR_ID)': 'user accessible',
  'application/canAccess() or service_install/canAccess()': 'app accessible',
  "service_type eq 'vpn'": 'vpn',
  'should_be_running_on__device/canAccess() or belongs_to__application/canAccess()': 'device or app accessible',
  'device/any(d:d/actor eq @__ACTOR_ID or d/is_managed_by__device/any(md:md/actor eq @__ACTOR_ID))':
    'device accessible',
  'image_install/canAccess() or image__is_part_of__release/canAccess()': 'image accessible',
  'owns__device/canAccess() or depends_on__application/canAccess(1) or ((is_host eq true or is_public eq true) and is_for__device_type/any(dt:dt/describes__device/canAccess()))':
    'device accessible',
  'belongs_to__application/any(a:a/actor eq @__ACTOR_ID)': 'app accessible',
  'is_managed_by__device/canAccess(1) or belongs_to__application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID)))':
    'app accessible',
  'belongs_to__application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID)))':
    'app accessible',
};

interface PermissionRecord extends RaRecord {
  name: string;
}

interface PermissionAssignmentRecord extends RaRecord {
  permission: Identifier;
}

interface PermissionChoice {
  id: Identifier;
  name: string;
  group?: string;
}

interface ManagePermissionsProps {
  source: string;
  reference: string;
  target: string;
}

const mapPermissionToChoice = (record: PermissionRecord): PermissionChoice => {
  const segments = record.name.split('.');
  const resource = segments[0] === 'resin' ? segments[1] : segments[0];

  const rawType = segments[0] === 'resin' ? segments[2]?.split('?')[0] : segments[1]?.split('?')[0];
  const type = rawType && rawType.length > 0 ? rawType : 'full';

  const rawOptions = segments[0] === 'resin' ? segments[2]?.split('?')[1] : segments[1]?.split('?')[1];
  const decodedOptions = rawOptions ? (decode[rawOptions] ?? rawOptions) : undefined;
  const label = decodedOptions ? `${type} (${decodedOptions})` : type;

  return {
    id: record.id,
    name: label,
    group: resource,
  };
};

export const ManagePermissions: React.FC<ManagePermissionsProps> = ({ source, reference, target }) => {
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();

  const { data: permissionRecords = [], isLoading: permissionsLoading } = useGetList<PermissionRecord>('permission', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  const { data: assignmentRecords = [], isLoading: assignmentsLoading } = useGetList<PermissionAssignmentRecord>(
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
    () => assignmentRecords.map((assignment) => assignment.permission).filter((id): id is Identifier => id != null),
    [assignmentRecords],
  );

  React.useEffect(() => {
    if (!initializedRef.current && !permissionsLoading && !assignmentsLoading) {
      setValue(source, selectedIds, { shouldDirty: false });
      initializedRef.current = true;
    }
  }, [assignmentsLoading, permissionsLoading, selectedIds, setValue, source]);

  const permissionChoices = React.useMemo<PermissionChoice[]>(
    () => permissionRecords.map(mapPermissionToChoice),
    [permissionRecords],
  );

  if (permissionsLoading || assignmentsLoading) {
    return <Loading />;
  }

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Permissions</strong>

      <AutocompleteArrayInput
        source={source}
        choices={permissionChoices}
        groupBy={(choice: PermissionChoice) => choice.group ?? 'Other'}
        label='Select permissions'
        fullWidth
        defaultValue={[]}
        sx={{ maxWidth: 360 }}
      />
    </Box>
  );
};

export default ManagePermissions;
