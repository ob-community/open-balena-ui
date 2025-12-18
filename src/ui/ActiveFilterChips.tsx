import React, { useEffect, useState } from 'react';
import { Box, Chip } from '@mui/material';
import { useDataProvider } from 'react-admin';
import type { DataProvider } from 'react-admin';
import type { ResourceRecord } from '../types/resource';
import type { DeviceFilterState, OnlineStatus } from './DeviceFilterModal';
import { getSemver } from './SemVerChip';

interface ActiveFilterChipsProps {
  filters: DeviceFilterState;
  onRemoveFilter: (filterKey: keyof DeviceFilterState) => void;
}

interface ResolvedLabels {
  deviceTypeName: string | null;
  fleetName: string | null;
  releaseLabels: string[];
}

export const ActiveFilterChips: React.FC<ActiveFilterChipsProps> = ({
  filters,
  onRemoveFilter,
}) => {
  const dataProvider = useDataProvider<DataProvider>();
  const [labels, setLabels] = useState<ResolvedLabels>({
    deviceTypeName: null,
    fleetName: null,
    releaseLabels: [],
  });

  const getNonNullReleaseIds = (ids: Array<number | null>): number[] =>
    ids.filter((id): id is number => id !== null);

  // Resolve IDs to human-readable names
  useEffect(() => {
    let cancelled = false;

    const resolveLabels = async () => {
      const newLabels: ResolvedLabels = {
        deviceTypeName: null,
        fleetName: null,
        releaseLabels: [],
      };

      const releaseIds = getNonNullReleaseIds(filters.releaseIds);

      // Short-circuit if there are no ID-based filters
      if (!filters.deviceTypeId && !filters.fleetId && releaseIds.length === 0) {
        if (!cancelled) {
          setLabels(newLabels);
        }
        return;
      }

      try {
        const [deviceTypeResp, fleetResp, releasesResp] = await Promise.all([
          filters.deviceTypeId
            ? dataProvider.getOne<ResourceRecord>('device type', {
                id: filters.deviceTypeId,
              })
            : Promise.resolve(null),
          filters.fleetId
            ? dataProvider.getOne<ResourceRecord>('application', {
                id: filters.fleetId,
              })
            : Promise.resolve(null),
          releaseIds.length > 0
            ? dataProvider.getMany<ResourceRecord>('release', {
                ids: releaseIds,
              })
            : Promise.resolve(null),
        ]);

        if (deviceTypeResp) {
          newLabels.deviceTypeName = deviceTypeResp.data.slug as string;
        } else if (filters.deviceTypeId) {
          newLabels.deviceTypeName = `ID: ${filters.deviceTypeId}`;
        }

        if (fleetResp) {
          newLabels.fleetName = fleetResp.data['app name'] as string;
        } else if (filters.fleetId) {
          newLabels.fleetName = `ID: ${filters.fleetId}`;
        }

        if (releasesResp) {
          newLabels.releaseLabels = releasesResp.data.map((release) => getSemver(release));
        } else if (releaseIds.length > 0) {
          newLabels.releaseLabels = releaseIds.map((id) => `ID: ${id}`);
        }
      } catch {
        // On error, fall back to raw IDs
        if (filters.deviceTypeId) {
          newLabels.deviceTypeName = `ID: ${filters.deviceTypeId}`;
        }
        if (filters.fleetId) {
          newLabels.fleetName = `ID: ${filters.fleetId}`;
        }
        const releaseIds = getNonNullReleaseIds(filters.releaseIds);
        if (releaseIds.length > 0) {
          newLabels.releaseLabels = releaseIds.map((id) => `ID: ${id}`);
        }
      }

      if (!cancelled) {
        setLabels(newLabels);
      }
    };

    void resolveLabels();

    return () => {
      cancelled = true;
    };
  }, [dataProvider, filters.deviceTypeId, filters.fleetId, filters.releaseIds]);

  // Check if there are any active filters
  const nonNullReleaseIds = getNonNullReleaseIds(filters.releaseIds);
  const hasActiveFilters =
    filters.onlineStatus !== 'all' ||
    filters.deviceTypeId !== null ||
    filters.fleetId !== null ||
    nonNullReleaseIds.length > 0 ||
    filters.osVersion !== '';

  if (!hasActiveFilters) {
    return null;
  }

  const getStatusLabel = (status: OnlineStatus): string => {
    switch (status) {
      case 'online':
        return 'Online';
      case 'offline':
        return 'Offline';
      default:
        return '';
    }
  };

  const getReleaseChipLabel = (): string => {
    const releaseIds = getNonNullReleaseIds(filters.releaseIds);

    if (releaseIds.length === 0) {
      return '';
    }
    if (releaseIds.length === 1) {
      return labels.releaseLabels[0] || 'Loading...';
    }
    return `${releaseIds.length} selected`;
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        py: 0,
        px: 0,
      }}
    >
      {/* Online Status Chip */}
      {filters.onlineStatus !== 'all' && (
        <Chip
          label={`Status: ${getStatusLabel(filters.onlineStatus)}`}
          onDelete={() => onRemoveFilter('onlineStatus')}
          size='small'
          color='primary'
          variant='outlined'
          sx={{ maxWidth: '180px' }}
        />
      )}

      {/* Device Type Chip */}
      {filters.deviceTypeId !== null && (
        <Chip
          label={`Type: ${labels.deviceTypeName || 'Loading...'}`}
          onDelete={() => onRemoveFilter('deviceTypeId')}
          size='small'
          color='primary'
          variant='outlined'
          sx={{ maxWidth: '180px' }}
        />
      )}

      {/* Fleet Chip */}
      {filters.fleetId !== null && (
        <Chip
          label={`Fleet: ${labels.fleetName || 'Loading...'}`}
          onDelete={() => onRemoveFilter('fleetId')}
          size='small'
          color='primary'
          variant='outlined'
          sx={{ maxWidth: '180px' }}
        />
      )}

      {/* Release Chip */}
      {nonNullReleaseIds.length > 0 && (
        <Chip
          label={`Release: ${getReleaseChipLabel()}`}
          onDelete={() => onRemoveFilter('releaseIds')}
          size='small'
          color='primary'
          variant='outlined'
          sx={{ maxWidth: '180px' }}
        />
      )}

      {/* OS Version Chip */}
      {filters.osVersion !== '' && (
        <Chip
          label={`OS: ${filters.osVersion}`}
          onDelete={() => onRemoveFilter('osVersion')}
          size='small'
          color='primary'
          variant='outlined'
          sx={{ maxWidth: '180px' }}
        />
      )}
    </Box>
  );
};

export default ActiveFilterChips;

