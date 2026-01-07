import React, { useEffect, useState, useMemo } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useGetList } from 'react-admin';
import { getSemver } from './SemVerChip';

export type OnlineStatus = 'all' | 'online' | 'offline';

export interface DeviceFilterState {
  onlineStatus: OnlineStatus;
  deviceTypeId: number | null;
  fleetId: number | null;
  // May contain a special `null` sentinel value to represent that the user
  // explicitly chose "Select None" for releases.
  releaseIds: Array<number | null>;
  osVersion: string;
}

export const defaultFilterState: DeviceFilterState = {
  onlineStatus: 'all',
  deviceTypeId: null,
  fleetId: null,
  releaseIds: [],
  osVersion: '',
};

interface DeviceType {
  id: number;
  slug: string;
}

interface Fleet {
  id: number;
  'app name': string;
  'is for-device type': number;
}

interface Release {
  id: number;
  'belongs to-application': number;
  'semver major': number;
  'semver minor': number;
  'semver patch': number;
  'semver prerelease': string;
  'semver build': string;
  'semver revision': number;
  commit: string;
  'created at': string;
}

export interface DeviceFilterModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (filters: DeviceFilterState) => void;
  currentFilters: DeviceFilterState;
}

export const DeviceFilterModal: React.FC<DeviceFilterModalProps> = ({
  open,
  onClose,
  onApply,
  currentFilters,
}) => {
  // Local state for the modal form
  const [localFilters, setLocalFilters] = useState<DeviceFilterState>(currentFilters);

  const getNonNullReleaseIds = (ids: Array<number | null>): number[] =>
    ids.filter((id): id is number => id !== null);

  // Fetch device types using useGetList (cached by react-query)
  const { data: deviceTypesData, isLoading: deviceTypesLoading } = useGetList(
    'device type',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'slug', order: 'ASC' },
      filter: {},
    },
    { enabled: open }
  );

  const deviceTypes = useMemo<DeviceType[]>(
    () =>
      deviceTypesData?.map((dt) => ({
        id: Number(dt.id),
        slug: dt.slug as string,
      })) ?? [],
    [deviceTypesData]
  );

  // Search state for OS version typeahead
  const [osVersionSearch, setOsVersionSearch] = useState('');
  const [debouncedOsVersionSearch, setDebouncedOsVersionSearch] = useState('');

  // Debounce the OS version search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedOsVersionSearch(osVersionSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [osVersionSearch]);

  // Only search when 3+ characters are entered
  const shouldSearchOsVersions = debouncedOsVersionSearch.length >= 3;

  // Fetch devices with OS version filter (cached by react-query)
  const { data: devicesData, isLoading: devicesLoading } = useGetList(
    'device',
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'os version', order: 'ASC' },
      filter: shouldSearchOsVersions ? { 'os version@ilike': debouncedOsVersionSearch } : {},
    },
    { enabled: open && shouldSearchOsVersions }
  );

  const osVersionOptions = useMemo<string[]>(() => {
    if (!devicesData) return [];
    const uniqueOsVersions = new Set<string>();
    devicesData.forEach((device) => {
      const osVersion = device['os version'] as string;
      if (osVersion) {
        uniqueOsVersions.add(osVersion);
      }
    });
    return Array.from(uniqueOsVersions).sort();
  }, [devicesData]);

  // Fetch fleets based on selected device type (cached by react-query)
  const fleetsFilter = useMemo(() => {
    const filter: Record<string, unknown> = { 'is of-class': 'fleet' };
    if (localFilters.deviceTypeId) {
      filter['is for-device type'] = localFilters.deviceTypeId;
    }
    return filter;
  }, [localFilters.deviceTypeId]);

  const { data: fleetsData } = useGetList(
    'application',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'app name', order: 'ASC' },
      filter: fleetsFilter,
    },
    { enabled: open }
  );

  const fleets = useMemo<Fleet[]>(
    () =>
      fleetsData?.map((fleet) => ({
        id: Number(fleet.id),
        'app name': fleet['app name'] as string,
        'is for-device type': fleet['is for-device type'] as number,
      })) ?? [],
    [fleetsData]
  );

  // Build releases filter based on device type and fleet selection
  const releasesFilter = useMemo(() => {
    const filter: Record<string, unknown> = {};

    if (localFilters.fleetId) {
      filter['belongs to-application'] = localFilters.fleetId;
    } else if (localFilters.deviceTypeId && fleets.length > 0) {
      const relevantFleetIds = fleets
        .filter((f) => f['is for-device type'] === localFilters.deviceTypeId)
        .map((f) => f.id);
      if (relevantFleetIds.length > 0) {
        filter['belongs to-application@in'] = `(${relevantFleetIds.join(',')})`;
      }
    }

    return filter;
  }, [localFilters.fleetId, localFilters.deviceTypeId, fleets]);

  // Pagination state for releases
  const [releasesPage, setReleasesPage] = useState(1);
  const [accumulatedReleases, setAccumulatedReleases] = useState<Release[]>([]);

  // Fetch releases with pagination (cached by react-query)
  const {
    data: releasesData,
    isFetching: releasesFetching,
    total: releasesTotal,
  } = useGetList(
    'release',
    {
      pagination: { page: releasesPage, perPage: 100 },
      sort: { field: 'id', order: 'DESC' },
      filter: releasesFilter,
    },
    { enabled: open }
  );

  // Track filter changes to reset pagination
  const [prevReleasesFilter, setPrevReleasesFilter] = useState(releasesFilter);

  // Reset page when filter changes
  useEffect(() => {
    if (releasesFilter !== prevReleasesFilter) {
      setPrevReleasesFilter(releasesFilter);
      setReleasesPage(1);
      setAccumulatedReleases([]);
    }
  }, [releasesFilter, prevReleasesFilter]);

  // Accumulate releases when data loads
  useEffect(() => {
    if (releasesData) {
      const newReleases = releasesData.map((r) => ({ ...r, id: Number(r.id) }) as Release);
      const newReleaseIds = newReleases.map((r) => r.id);

      if (releasesPage === 1) {
        // Replace all releases on page 1 (handles filter changes)
        setAccumulatedReleases(newReleases);
      } else {
        // Append for subsequent pages (de-duplicated)
        setAccumulatedReleases((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const deduped = newReleases.filter((r) => !existingIds.has(r.id));
          return [...prev, ...deduped];
        });
        // Auto-select newly loaded releases (de-duplicated)
        setLocalFilters((prev) => ({
          ...prev,
          releaseIds: Array.from(new Set([...prev.releaseIds, ...newReleaseIds])),
        }));
      }
    }
  }, [releasesData, releasesPage]);

  // Use accumulated releases
  const releases = accumulatedReleases;

  // Check if there are more releases to load
  const hasMoreReleases = releasesTotal !== undefined && accumulatedReleases.length < releasesTotal;

  const handleLoadMoreReleases = () => {
    setReleasesPage((p) => p + 1);
  };

  // Combined loading state
  const isLoading = deviceTypesLoading;

  // Sync local filters with current filters when modal opens
  useEffect(() => {
    if (open) {
      setLocalFilters(currentFilters);
      // Set OS version search to current filter value
      setOsVersionSearch(currentFilters.osVersion);
      setDebouncedOsVersionSearch(currentFilters.osVersion);
      // Reset releases pagination
      setReleasesPage(1);
    }
  }, [open, currentFilters]);

  // Auto-select all releases when none are chosen and no release filter exists (unless a `null` sentinel is present).
  useEffect(() => {
    const hasNullSentinel = localFilters.releaseIds.includes(null);
    const localNonNullIds = getNonNullReleaseIds(localFilters.releaseIds);
    const currentNonNullIds = getNonNullReleaseIds(currentFilters.releaseIds);

    if (
      open &&
      !hasNullSentinel &&
      releases.length > 0 &&
      localNonNullIds.length === 0 &&
      currentNonNullIds.length === 0
    ) {
      setLocalFilters((prev) => ({
        ...prev,
        releaseIds: releases.map((r) => r.id),
      }));
    }
  }, [
    open,
    releases,
    localFilters.releaseIds,
    currentFilters.releaseIds,
  ]);

  // Filter releases based on device type and fleet selection
  const filteredReleases = useMemo(() => {
    let filtered = releases;

    if (localFilters.fleetId) {
      filtered = filtered.filter((r) => r['belongs to-application'] === localFilters.fleetId);
    } else if (localFilters.deviceTypeId) {
      const relevantFleetIds = fleets
        .filter((f) => f['is for-device type'] === localFilters.deviceTypeId)
        .map((f) => f.id);
      filtered = filtered.filter((r) => relevantFleetIds.includes(r['belongs to-application']));
    }

    return filtered;
  }, [releases, fleets, localFilters.deviceTypeId, localFilters.fleetId]);

  // If there are no releases available for the current device/fleet filter,
  // drop any previously selected release IDs (but keep an explicit `null` sentinel, if present).
  useEffect(() => {
    const nonNullReleaseIds = getNonNullReleaseIds(localFilters.releaseIds);
    if (open && filteredReleases.length === 0 && nonNullReleaseIds.length > 0) {
      setLocalFilters((prev) => ({
        ...prev,
        releaseIds: prev.releaseIds.includes(null) ? [null] : [],
      }));
    }
  }, [open, filteredReleases, localFilters.releaseIds]);

  const releaseMatchesSelection = (
    release: Release,
    nextDeviceTypeId: number | null,
    nextFleetId: number | null
  ) => {
    if (nextFleetId) {
      return release['belongs to-application'] === nextFleetId;
    }

    if (nextDeviceTypeId) {
      const relevantFleetIds = fleets
        .filter((f) => f['is for-device type'] === nextDeviceTypeId)
        .map((f) => f.id);
      if (relevantFleetIds.length > 0) {
        return relevantFleetIds.includes(release['belongs to-application']);
      }
    }

    // No device/fleet filter => all releases are valid
    return true;
  };

  // Handlers
  const handleOnlineStatusChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFilters((prev) => ({
      ...prev,
      onlineStatus: event.target.value as OnlineStatus,
    }));
  };

  const handleDeviceTypeChange = (event: SelectChangeEvent<number | ''>) => {
    const value = event.target.value;
    const nextDeviceTypeId = value === '' ? null : Number(value);

    setLocalFilters((prev) => ({
      ...prev,
      deviceTypeId: nextDeviceTypeId,
      fleetId: null, // Reset fleet when device type changes
      // Keep only releases that still match the new device type (via its fleets)
      releaseIds: getNonNullReleaseIds(prev.releaseIds).filter((id) => {
        const found = accumulatedReleases.find((r) => r.id === id);
        return found ? releaseMatchesSelection(found, nextDeviceTypeId, null) : false;
      }),
    }));
  };

  const handleFleetChange = (event: SelectChangeEvent<number | ''>) => {
    const value = event.target.value;
    const nextFleetId = value === '' ? null : Number(value);

    setLocalFilters((prev) => ({
      ...prev,
      fleetId: nextFleetId,
      // Keep only releases that still match the new fleet/deviceType
      releaseIds: getNonNullReleaseIds(prev.releaseIds).filter((id) => {
        const found = accumulatedReleases.find((r) => r.id === id);
        return found ? releaseMatchesSelection(found, prev.deviceTypeId, nextFleetId) : false;
      }),
    }));
  };

  const handleReleaseToggle = (releaseId: number) => {
    setLocalFilters((prev) => {
      const currentIds = getNonNullReleaseIds(prev.releaseIds);
      const isCurrentlySelected = currentIds.includes(releaseId);

      const withoutId = currentIds.filter((id) => id !== releaseId);
      const nextIds: Array<number | null> = isCurrentlySelected
        ? withoutId.length === 0
          ? [null] // Explicit "Select None" sentinel
          : withoutId
        : [...currentIds, releaseId];

      return {
        ...prev,
        releaseIds: nextIds,
      };
    });
  };

  const handleSelectAllReleases = () => {
    // Select all visible releases explicitly
    setLocalFilters((prev) => ({
      ...prev,
      releaseIds: filteredReleases.map((r) => r.id),
    }));
  };

  const handleSelectNoneReleases = () => {
    // Clear all selections
    setLocalFilters((prev) => ({
      ...prev,
      // A single `null` sentinel marks the explicit "Select None" choice
      releaseIds: [null],
    }));
  };

  const handleOsVersionChange = (_event: React.SyntheticEvent, value: string | null) => {
    setLocalFilters((prev) => ({
      ...prev,
      osVersion: value ?? '',
    }));
  };

  const handleOsVersionInputChange = (_event: React.SyntheticEvent, value: string) => {
    setOsVersionSearch(value);
    // Also update the filter value as user types (freeSolo mode)
    setLocalFilters((prev) => ({
      ...prev,
      osVersion: value,
    }));
  };

  const handleApply = () => {
    const effectiveReleaseIds = getNonNullReleaseIds(localFilters.releaseIds);
    // Start with a copy of local filters, but strip out any `null` sentinel so
    // that we never propagate it into the actual list filters.
    const filtersToApply: DeviceFilterState = {
      ...localFilters,
      releaseIds: effectiveReleaseIds,
    };

    // If all releases are selected, don't apply release filter (empty array = no filter)
    if (
      filteredReleases.length > 0 &&
      filteredReleases.every((r) => effectiveReleaseIds.includes(r.id))
    ) {
      filtersToApply.releaseIds = [];
    }
    onApply(filtersToApply);
    onClose();
  };

  const handleReset = () => {
    setLocalFilters(defaultFilterState);
    setOsVersionSearch('');
    setDebouncedOsVersionSearch('');
    setReleasesPage(1);
    setAccumulatedReleases([]);
  };

  // Check if a release is selected
  const isReleaseSelected = (releaseId: number) => {
    const currentIds = getNonNullReleaseIds(localFilters.releaseIds);
    return currentIds.includes(releaseId);
  };

  const allReleasesSelected =
    filteredReleases.length > 0 &&
    filteredReleases.every((r) => isReleaseSelected(r.id));

  const noReleasesSelected = localFilters.releaseIds.includes(null);

  return (
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle>Filter Devices</DialogTitle>

      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            {/* Online Status */}
            <FormControl fullWidth size='small'>
              <InputLabel shrink sx={{ position: 'relative', transform: 'none', mb: 0.5 }}>
                Online Status
              </InputLabel>
              <RadioGroup
                row
                value={localFilters.onlineStatus}
                onChange={handleOnlineStatusChange}
              >
                <FormControlLabel value='all' control={<Radio size='small' />} label='All' />
                <FormControlLabel value='online' control={<Radio size='small' />} label='Online' />
                <FormControlLabel value='offline' control={<Radio size='small' />} label='Offline' />
              </RadioGroup>
            </FormControl>

            {/* Device Type */}
            <FormControl fullWidth size='small'>
              <InputLabel id='device-type-label'>Device Type</InputLabel>
              <Select
                labelId='device-type-label'
                value={localFilters.deviceTypeId ?? ''}
                label='Device Type'
                onChange={handleDeviceTypeChange}
              >
                <MenuItem value=''>
                  <em>All Device Types</em>
                </MenuItem>
                {deviceTypes.map((dt) => (
                  <MenuItem key={dt.id} value={dt.id}>
                    {dt.slug}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Fleet */}
            <FormControl fullWidth size='small'>
              <InputLabel id='fleet-label'>Fleet</InputLabel>
              <Select
                labelId='fleet-label'
                value={localFilters.fleetId ?? ''}
                label='Fleet'
                onChange={handleFleetChange}
              >
                <MenuItem value=''>
                  <em>All Fleets</em>
                </MenuItem>
                {fleets.map((fleet) => (
                  <MenuItem key={fleet.id} value={fleet.id}>
                    {fleet['app name']}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Current Release */}
            <FormControl fullWidth size='small'>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <InputLabel shrink sx={{ position: 'relative', transform: 'none', overflow: 'visible' }}>
                  Running Release
                </InputLabel>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size='small' variant='outlined' onClick={handleSelectAllReleases} disabled={allReleasesSelected}>
                    Select All
                  </Button>
                  <Button size='small' variant='outlined' onClick={handleSelectNoneReleases} disabled={noReleasesSelected}>
                    Select None
                  </Button>
                </Box>
              </Box>
              <Box
                sx={(theme) => ({
                  height: 200,
                  overflowY: 'scroll',
                  border: '1px solid',
                  borderColor: theme.palette.text.disabled,
                  borderRadius: `${theme.shape.borderRadius}px`,
                  mt: 1,
                  p: 1,
                  '&:hover': {
                    borderColor: theme.palette.text.primary,
                  },
                })}
              >
                {filteredReleases.length === 0 ? (
                  <Typography variant='body2' color='text.secondary' sx={{ p: 1 }}>
                    {releasesFetching ? 'Loading releases...' : 'No releases available'}
                  </Typography>
                ) : (
                  <>
                    {filteredReleases.map((release) => (
                      <FormControlLabel
                        key={release.id}
                        control={
                          <Checkbox
                            checked={isReleaseSelected(release.id)}
                            onChange={() => handleReleaseToggle(release.id)}
                            size='small'
                          />
                        }
                        label={
                          <ListItemText
                            primary={getSemver(release)}
                            secondary={release['created at'] ? 'Released on ' + new Date(release['created at']).toLocaleDateString() : ''}
                          />
                        }
                        sx={{ display: 'flex', width: '100%', m: 0 }}
                      />
                    ))}
                    {hasMoreReleases && (
                      <Button
                        fullWidth
                        size='small'
                        onClick={handleLoadMoreReleases}
                        disabled={releasesFetching}
                        sx={{ my: 1 }}
                        variant='outlined'
                      >
                        {releasesFetching
                          ? 'Loading...'
                          : `Load More (${accumulatedReleases.length} of ${releasesTotal})`}
                      </Button>
                    )}
                  </>
                )}
              </Box>
            </FormControl>

            {/* Operating System */}
            <Autocomplete
              freeSolo
              size='medium'
              options={osVersionOptions}
              value={localFilters.osVersion}
              onChange={handleOsVersionChange}
              onInputChange={handleOsVersionInputChange}
              inputValue={osVersionSearch}
              loading={devicesLoading}
              noOptionsText={
                osVersionSearch.length < 3
                  ? 'Type at least 3 characters to search'
                  : 'No OS versions found'
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label='Operating System'
                  placeholder='Search OS versions...'
                  InputLabelProps={{ sx: { overflow: 'visible' } }}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {devicesLoading ? <CircularProgress color='inherit' size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleReset} color='inherit' size='medium'>
          Reset
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} variant='outlined' size='medium'>
          Cancel
        </Button>
        <Button onClick={handleApply} variant='contained' size='medium'>
          Apply Filters
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeviceFilterModal;

