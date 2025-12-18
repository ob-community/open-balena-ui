import { Box, Button } from '@mui/material';
import { ManageSearch } from '@mui/icons-material';
import * as React from 'react';
import { useListContext } from 'react-admin';
import DeviceFilterModal, { DeviceFilterState } from './DeviceFilterModal';
import ActiveFilterChips from './ActiveFilterChips';

// Custom filter button component
const DeviceFilterButton: React.FC<{
  onClick: () => void;
  hasActiveFilters: boolean;
}> = ({ onClick, hasActiveFilters }) => {
  return (
    <Button
      variant='outlined'
      size='small'
      startIcon={<ManageSearch />}
      onClick={onClick}
      color={hasActiveFilters ? 'primary' : 'inherit'}
      sx={{ ml: 1 }}
    >
      Filter
    </Button>
  );
};

// Helper to safely coerce potentially string IDs into numbers
const toOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

const getNonNullReleaseIds = (ids: Array<number | null>): number[] =>
  ids.filter((id): id is number => id !== null);

// Helper to convert DeviceFilterState to react-admin filter object
export const convertToListFilters = (filters: DeviceFilterState): Record<string, unknown> => {
  const listFilters: Record<string, unknown> = {};

  if (filters.onlineStatus !== 'all') {
    listFilters['api heartbeat state@eq'] = filters.onlineStatus;
  }

  if (filters.deviceTypeId !== null) {
    listFilters['is of-device type@eq'] = filters.deviceTypeId;
  }

  if (filters.fleetId !== null) {
    listFilters['belongs to-application@eq'] = filters.fleetId;
  }

  const releaseIds = getNonNullReleaseIds(filters.releaseIds);
  if (releaseIds.length > 0) {
    listFilters['is running-release@in'] = `(${releaseIds.join(',')})`;
  }

  if (filters.osVersion !== '') {
    listFilters['os version@ilike'] = filters.osVersion;
  }

  return listFilters;
};

// Check if there are any active structured filters
export const hasActiveStructuredFilters = (filters: DeviceFilterState): boolean => {
  const releaseIds = getNonNullReleaseIds(filters.releaseIds);
  return (
    filters.onlineStatus !== 'all' ||
    filters.deviceTypeId !== null ||
    filters.fleetId !== null ||
    releaseIds.length > 0 ||
    filters.osVersion !== ''
  );
};

// Helper to derive structured filters from react-admin's filterValues
export const deriveStructuredFilters = (filterValues: Record<string, unknown>): DeviceFilterState => {
  const onlineStatus = (filterValues['api heartbeat state@eq'] as string) || 'all';
  const deviceTypeId = toOptionalNumber(filterValues['is of-device type@eq']);
  const fleetId = toOptionalNumber(filterValues['belongs to-application@eq']);

  // Parse release IDs from the "(1,2,3)" format, a simple comma-separated string,
  // or an array of values. This keeps us resilient to backend/react-admin changes.
  let releaseIds: Array<number | null> = [];
  const releaseFilter = filterValues['is running-release@in'];

  if (typeof releaseFilter === 'string') {
    const trimmed = releaseFilter.trim();
    const inner =
      trimmed.startsWith('(') && trimmed.endsWith(')')
        ? trimmed.slice(1, -1)
        : trimmed;

    releaseIds = inner
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => !Number.isNaN(id));
  } else if (Array.isArray(releaseFilter)) {
    releaseIds = releaseFilter
      .map((id) => Number(id))
      .filter((id) => !Number.isNaN(id));
  }

  const osVersion = (filterValues['os version@ilike'] as string) || '';

  return {
    onlineStatus: onlineStatus as DeviceFilterState['onlineStatus'],
    deviceTypeId,
    fleetId,
    releaseIds,
    osVersion,
  };
};

// Custom filter component for structured filtering (like ActorFilter pattern)
interface DeviceStructuredFilterProps {
  alwaysOn?: boolean;
}

const STRUCTURED_FILTER_KEYS = [
  'api heartbeat state@eq',
  'is of-device type@eq',
  'belongs to-application@eq',
  'is running-release@in',
  'os version@ilike',
] as const;

const DeviceStructuredFilter: React.FC<DeviceStructuredFilterProps> = ({
  // alwaysOn is used by react-admin's List component to determine filter visibility
  alwaysOn: _alwaysOn,
}) => {
  const { filterValues, setFilters } = useListContext();
  const [isFilterModalOpen, setIsFilterModalOpen] = React.useState(false);

  // Derive structured filters directly from react-admin's filterValues (single source of truth)
  const structuredFilters = React.useMemo(() => deriveStructuredFilters(filterValues), [filterValues]);

  const handleApplyFilters = React.useCallback(
    (newFilters: DeviceFilterState) => {
      const convertedFilters = convertToListFilters(newFilters);

      // Start from current filters, remove any existing structured keys,
      // then overlay the new structured filters. This preserves any
      // non-structured filters (e.g. text search, quick filters).
      const nextFilters: Record<string, unknown> = { ...filterValues };
      for (const key of STRUCTURED_FILTER_KEYS) {
        delete nextFilters[key];
      }

      Object.assign(nextFilters, convertedFilters);

      setFilters(nextFilters, undefined, false);
    },
    [filterValues, setFilters]
  );

  const handleRemoveFilter = React.useCallback(
    (filterKey: keyof DeviceFilterState) => {
      // Create updated filters based on current derived state
      const updatedFilters: DeviceFilterState = { ...structuredFilters };

      switch (filterKey) {
        case 'onlineStatus':
          updatedFilters.onlineStatus = 'all';
          break;
        case 'deviceTypeId':
          updatedFilters.deviceTypeId = null;
          break;
        case 'fleetId':
          updatedFilters.fleetId = null;
          break;
        case 'releaseIds':
          updatedFilters.releaseIds = [];
          break;
        case 'osVersion':
          updatedFilters.osVersion = '';
          break;
      }

      handleApplyFilters(updatedFilters);
    },
    [structuredFilters, handleApplyFilters]
  );

  const hasActiveFilters = hasActiveStructuredFilters(structuredFilters);

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
      <DeviceFilterButton onClick={() => setIsFilterModalOpen(true)} hasActiveFilters={hasActiveFilters} />
      {hasActiveFilters && <ActiveFilterChips filters={structuredFilters} onRemoveFilter={handleRemoveFilter} />}
      <DeviceFilterModal
        open={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        onApply={handleApplyFilters}
        currentFilters={structuredFilters}
      />
    </Box>
  );
};

export default DeviceStructuredFilter;

