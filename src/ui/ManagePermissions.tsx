// src/ui/ManagePermissions.tsx
import React from 'react';
import { Box, Tooltip, useTheme } from '@mui/material';
import { Identifier, Loading, RaRecord, TextInput, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';
import GenericTransferList, { TransferListOption } from '../components/genericTransferList';
import {
  collapsePermissions,
  expandSelections,
  normalizePredicate,
  parseRawPermission,
  type ListedPermission,
} from '../lib/permissionsNormalizer';

interface PermissionRecord extends RaRecord {
  name: string; // e.g. 'resin.device.read?actor eq @__ACTOR_ID'
}

interface PermissionAssignmentRecord extends RaRecord {
  permission: Identifier;
}

interface ManagePermissionsProps {
  source: string;
  reference: string;
  target: string;
}

// Updated type to use the imported parser
type ParsedItem = ListedPermission & {
  id: Identifier;
  resource: string;
  rawName: string; // Store the original name
};

// Removed the local, incorrect parseName function.

export const ManagePermissions: React.FC<ManagePermissionsProps> = ({ source, reference, target }) => {
  const theme = useTheme();
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();

  // UI selection stores NORMALIZED KEYS (synthetic ids from collapse)
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([]);

  // State to control tooltips and hide them on scroll
  const [activeTooltipKey, setActiveTooltipKey] = React.useState<string | null>(null);

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
    { enabled: Boolean(record?.id) },
  );

  // Reset selection when record changes
  React.useEffect(() => {
    setSelectedKeys([]);
  }, [record?.id]);

  // Parse to the shape collapsePermissions expects (using the correct imported function)
  const parsed: ParsedItem[] = React.useMemo(
    () =>
      permissionRecords.map((p) => ({
        ...parseRawPermission(p.name),
        id: p.id,
        rawName: p.name,
      })),
    [permissionRecords],
  );

  // Collapse duplicates to normalized options
  const collapsed = React.useMemo(() => collapsePermissions(parsed), [parsed]);

  // Build rawId -> normalizedKey map for initializing selection
  const idToKey = React.useMemo(() => {
    const m = new Map<Identifier, string>();
    for (const [key, items] of collapsed.keyToItems.entries()) {
      for (const it of items as ParsedItem[]) {
        m.set(it.id, key);
      }
    }
    return m;
  }, [collapsed]);

  // Selected raw ids from assignments
  const selectedRawIds: Identifier[] = React.useMemo(
    () => assignmentRecords.map((a) => a.permission).filter((id): id is Identifier => id != null),
    [assignmentRecords],
  );

  // Initialize UI selection and hidden form value once data is ready
  React.useEffect(() => {
    if (permissionsLoading || assignmentsLoading) return;

    const keys = Array.from(new Set(selectedRawIds.map((id) => idToKey.get(id)).filter((k): k is string => !!k)));
    setSelectedKeys(keys);

    // Expand normalized keys back to raw ids for the payload
    const expandedItems = expandSelections(collapsed, keys) as ParsedItem[];
    const expandedRawIds = expandedItems.map((it) => it.id);
    setValue(source, expandedRawIds, { shouldDirty: false });
  }, [permissionsLoading, assignmentsLoading, selectedRawIds, idToKey, collapsed, setValue, source]);

  // Options for the transfer list
  // We rebuild the options from keyToItems to store verb/predicate parts for styling
  const permissionOptions: TransferListOption[] = React.useMemo(() => {
    const out: Array<TransferListOption & { verb: string; predicate: string }> = [];
    for (const [key, items] of collapsed.keyToItems.entries()) {
      const first = (items[0] as ParsedItem) ?? ({} as ParsedItem);
      const normalizedPredicate = normalizePredicate(first.predicate ?? '');

      out.push({
        id: key,
        label: '', // Label is now built by renderOption
        group: first.resource,
        // Store parts for custom rendering
        verb: first.verb === 'full' ? 'all' : first.verb,
        predicate: normalizedPredicate,
      });
    }
    // Sort by group, then verb, then predicate
    out.sort((a, b) => {
      const ga = a.group ?? '';
      const gb = b.group ?? '';
      if (ga !== gb) return ga.localeCompare(gb);
      if (a.verb !== b.verb) return a.verb.localeCompare(b.verb);
      return a.predicate.localeCompare(b.predicate);
    });
    return out;
  }, [collapsed]);

  // Build tooltip text (raw permission names) per normalized key
  const tooltipByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, items] of collapsed.keyToItems.entries()) {
      const lines = (items as ParsedItem[]).map((it) => it.rawName);
      map.set(key, lines.join('\n'));
    }
    return map;
  }, [collapsed]);

  // When user changes selection, expand to raw ids and write into form
  const handleSelectionChange = React.useCallback(
    (nextKeys: Identifier[]) => {
      const keys = nextKeys.map(String);
      setSelectedKeys(keys);

      const expandedItems = expandSelections(collapsed, keys) as ParsedItem[];
      const expandedRawIds = expandedItems.map((it) => it.id);
      setValue(source, expandedRawIds, { shouldDirty: true });
    },
    [collapsed, setValue, source],
  );

  if (permissionsLoading || assignmentsLoading) return <Loading />;

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Permissions</strong>

      <GenericTransferList
        options={permissionOptions}
        value={selectedKeys}
        onChange={handleSelectionChange}
        availableLabel='Available'
        selectedLabel='Selected'
        listWidth={360}
        listHeight={400}
        onListScroll={() => setActiveTooltipKey(null)}
        renderOption={(opt) => {
          // Cast to get our custom verb/predicate props
          const { verb, predicate } = opt as TransferListOption & { verb?: string; predicate?: string };
          const key = String(opt.id);
          const isOpen = activeTooltipKey === key;

          return (
            <Tooltip
              arrow
              placement='right'
              enterDelay={400}
              open={isOpen}
              onOpen={() => setActiveTooltipKey(key)}
              onClose={() => setActiveTooltipKey(null)}
              slotProps={{
                popper: {
                  style: {
                    maxWidth: '90vw',
                  },
                },
              }}
              title={
                <Box
                  sx={{
                    m: 0,
                    whiteSpace: 'pre-wrap', // Respects newlines and wraps
                    ...theme.monoTypography,
                    fontSize: 11,
                    wordBreak: 'break-word', // Breaks long, unbroken strings
                  }}
                >
                  {tooltipByKey.get(key) || ''}
                </Box>
              }
            >
              <Box
                component='span'
                sx={{ display: 'block', width: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}
              >
                <Box component='strong' sx={{ fontWeight: 700 }}>
                  {verb}
                </Box>
                {predicate && (
                  <Box component='em' sx={{ ml: 0.5, fontStyle: 'italic', color: 'text.secondary' }}>
                    ({predicate})
                  </Box>
                )}
              </Box>
            </Tooltip>
          );
        }}
      />

      {/* Hidden field stores expanded raw IDs expected by the API */}
      <TextInput source={source} defaultValue={[]} sx={{ display: 'none' }} />
    </Box>
  );
};

export default ManagePermissions;
