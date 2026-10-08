import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import * as React from 'react';
import { useDataProvider, useNotify, useRecordContext, useRefresh } from 'react-admin';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import environment from '../lib/reactAppEnv';
import { getSemver } from './SemVerChip';
import type { ResourceRecord } from '../types/resource';
import versions from '../versions';
import { deviceRefreshFailure, type ResolvedDeviceActionTarget } from '../lib/deviceRefresh';
import { refreshDeviceStateQueries, useDeviceRefreshActions } from './useDeviceRefreshActions';
import { useQueryClient } from '@tanstack/react-query';

const applicationClass = versions.optionalField('applicationIsOfClass', environment.REACT_APP_OPEN_BALENA_API_VERSION);

interface Choice {
  id: number | string;
  name: string;
  knownIssues?: string[];
  targetVersion?: string;
  updateData?: Record<string, unknown>;
}

interface DeviceFieldEditorProps {
  source: string;
  title: string;
  children?: React.ReactNode;
  currentValue?: number | string | null;
  emptyLabel?: string;
  emptyChoiceLast?: boolean;
  defaultToFirstChoice?: boolean;
  notice?: React.ReactNode;
  iconOnly?: boolean;
  loadChoices?: (dataProvider: OpenBalenaDataProvider, record: ResourceRecord) => Promise<Choice[]>;
  multiline?: boolean;
  required?: boolean;
  saveChoice?: (
    dataProvider: OpenBalenaDataProvider,
    record: ResourceRecord,
    choice: Choice,
  ) => Promise<void | ResolvedDeviceActionTarget>;
  updateData?: (value: number | string | null, record: ResourceRecord) => Record<string, unknown>;
  onUpdated?: (value: number | string | null) => Promise<void>;
}

export const DeviceFieldEditor: React.FC<DeviceFieldEditorProps> = ({
  source,
  title,
  children,
  currentValue,
  emptyLabel,
  emptyChoiceLast = false,
  defaultToFirstChoice = false,
  notice,
  iconOnly = false,
  loadChoices,
  multiline = false,
  required = false,
  saveChoice,
  updateData,
  onUpdated,
}) => {
  const record = useRecordContext<ResourceRecord>();
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const refreshActions = useDeviceRefreshActions();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState<number | string>('');
  const [initialValue, setInitialValue] = React.useState<number | string>('');
  const [choices, setChoices] = React.useState<Choice[]>();
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const choiceRequest = React.useRef(0);

  React.useEffect(() => {
    return () => {
      choiceRequest.current++;
    };
  }, []);

  const closeDialog = () => {
    choiceRequest.current++;
    setOpen(false);
  };

  const openDialog = () => {
    if (!record) return;
    const request = ++choiceRequest.current;
    const startingValue = currentValue ?? '';
    setInitialValue(startingValue);
    setValue(startingValue);
    setChoices(undefined);
    setLoading(Boolean(loadChoices));
    setOpen(true);
    if (!loadChoices) return;

    loadChoices(dataProvider, record)
      .then((loadedChoices) => {
        if (choiceRequest.current === request) {
          setChoices(loadedChoices);
          if (defaultToFirstChoice && startingValue === '' && loadedChoices[0]) {
            setValue(loadedChoices[0].id);
          }
        }
      })
      .catch((error: unknown) => {
        if (choiceRequest.current === request) {
          notify(error instanceof Error ? error.message : `Unable to load ${title.toLowerCase()} choices.`, {
            type: 'error',
          });
          closeDialog();
        }
      })
      .finally(() => {
        if (choiceRequest.current === request) setLoading(false);
      });
  };

  if (!record) return null;

  const save = async () => {
    if (required && value === '') return;
    const nextValue = value === '' ? null : value;
    setSaving(true);
    let fieldUpdated = false;
    let actionId: string | undefined;
    const refreshRecord = () => {
      if (!actionId) {
        refresh();
        return;
      }
      refreshDeviceStateQueries(queryClient, record.id);
    };
    try {
      const selectedChoice = choices?.find((choice) => String(choice.id) === String(value));
      const pin = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
      const kind =
        source === 'should be operated by-release'
          ? 'host-os'
          : source === 'should be managed by-release'
            ? 'supervisor'
            : source === pin
              ? 'release'
              : undefined;
      if (kind)
        actionId = refreshActions.begin({
          deviceId: record.id,
          kind,
          targetField: source,
          targetReleaseId: nextValue,
          targetVersion: selectedChoice?.targetVersion,
          baselineFailure: deviceRefreshFailure(record),
        });
      let resolvedTarget: ResolvedDeviceActionTarget | undefined;
      if (selectedChoice && saveChoice) {
        resolvedTarget = (await saveChoice(dataProvider, record, selectedChoice)) ?? undefined;
      } else {
        await dataProvider.update('device', {
          id: record.id,
          data: selectedChoice?.updateData ?? (updateData ? updateData(nextValue, record) : { [source]: nextValue }),
          previousData: record,
        });
      }
      fieldUpdated = true;
      if (actionId) refreshActions.acknowledge(actionId, resolvedTarget);
      await onUpdated?.(nextValue);
      notify(`${title} updated.`, { type: 'success' });
      closeDialog();
      refreshRecord();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to update ${title.toLowerCase()}.`;
      notify(fieldUpdated ? `${title} updated, but related records could not be reconciled: ${message}` : message, {
        type: 'error',
      });
      if (!fieldUpdated && actionId) refreshActions.cancel(actionId);
      if (fieldUpdated) {
        closeDialog();
        refreshRecord();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {iconOnly ? (
        <Button
          aria-label={`Edit ${title.toLowerCase()}`}
          variant='text'
          color='inherit'
          size='small'
          onClick={openDialog}
          sx={{
            'minWidth': 0,
            'ml': 0.25,
            'p': 0.25,
            'backgroundColor': 'transparent',
            'verticalAlign': 'middle',
            '&:hover': { backgroundColor: 'transparent' },
          }}
        >
          <EditOutlinedIcon sx={{ fontSize: '1rem' }} />
        </Button>
      ) : (
        <Button
          variant='text'
          color='inherit'
          size='small'
          onClick={openDialog}
          endIcon={<EditOutlinedIcon fontSize='inherit' />}
          sx={{
            'minWidth': 0,
            'p': 0,
            'backgroundColor': 'transparent',
            'textTransform': 'none',
            'verticalAlign': 'baseline',
            '&:hover': { backgroundColor: 'transparent' },
          }}
        >
          {children}
        </Button>
      )}
      <Dialog open={open} onClose={() => !saving && closeDialog()} fullWidth maxWidth='sm'>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          {notice}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          ) : choices ? (
            <TextField
              select
              fullWidth
              margin='normal'
              label={title}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              SelectProps={{
                renderValue: (selected) =>
                  choices.find((choice) => String(choice.id) === String(selected))?.name ??
                  emptyLabel ??
                  String(selected),
              }}
            >
              {!required && !emptyChoiceLast && <MenuItem value=''>{emptyLabel ?? 'None'}</MenuItem>}
              {choices.map((choice) => (
                <MenuItem
                  key={choice.id}
                  value={choice.id}
                  sx={{ alignItems: 'flex-start', py: choice.knownIssues?.length ? 1.5 : 1 }}
                >
                  <Box sx={{ width: '100%' }}>
                    <Typography>{choice.name}</Typography>
                    {choice.knownIssues?.map((issue, index) => (
                      <Box
                        key={`${choice.id}-issue-${index}`}
                        sx={{
                          alignItems: 'flex-start',
                          bgcolor: 'action.hover',
                          borderLeft: 3,
                          borderColor: 'warning.main',
                          display: 'flex',
                          gap: 1,
                          mt: 1,
                          p: 1,
                          whiteSpace: 'normal',
                        }}
                      >
                        <WarningAmberIcon color='warning' sx={{ fontSize: '1rem', mt: 0.25 }} />
                        <Typography variant='body2'>{issue}</Typography>
                      </Box>
                    ))}
                  </Box>
                </MenuItem>
              ))}
              {!required && emptyChoiceLast && <MenuItem value=''>{emptyLabel ?? 'None'}</MenuItem>}
            </TextField>
          ) : (
            <TextField
              autoFocus
              fullWidth
              margin='normal'
              label={title}
              multiline={multiline}
              minRows={multiline ? 4 : undefined}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant='contained'
            onClick={save}
            disabled={saving || loading || (required && value === '') || value === initialValue}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export const loadFleetChoices = async (dataProvider: OpenBalenaDataProvider): Promise<Choice[]> => {
  const { data } = await dataProvider.getList('application', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'app name', order: 'ASC' },
    filter: applicationClass ? { [applicationClass]: 'fleet' } : {},
  });
  return data.map((fleet) => ({ id: fleet.id, name: String(fleet['app name'] ?? fleet.id) }));
};

export const loadTargetReleaseChoices = async (
  dataProvider: OpenBalenaDataProvider,
  record: ResourceRecord,
): Promise<Choice[]> => {
  const { data } = await dataProvider.getList('release', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'id', order: 'DESC' },
    filter: { 'belongs to-application': record['belongs to-application'] },
  });
  return data.map((release) => ({ id: release.id, name: getSemver(release) }));
};

const loadUpdateChoices =
  (kind: 'operatingSystems' | 'supervisors') =>
  async (dataProvider: OpenBalenaDataProvider, record: ResourceRecord): Promise<Choice[]> => {
    const deviceTypeId = Number(record['is of-device type']);
    const currentOsVersion = String(record['os version'] ?? '');
    const currentSupervisorVersion = String(record['supervisor version'] ?? '');
    const options = await dataProvider.getDeviceUpdateOptions({
      deviceTypeId,
      currentOsVersion,
      currentSupervisorVersion,
    });
    return options[kind].map((option, index) => ({
      id: option.id,
      name: `${option.version}${index === 0 ? ' (recommended)' : ''}`,
      knownIssues: option.knownIssues,
      targetVersion: option.version,
    }));
  };

export const loadOperatingSystemChoices = loadUpdateChoices('operatingSystems');
export const loadSupervisorChoices = loadUpdateChoices('supervisors');

export const saveSupervisorTarget = async (
  dataProvider: OpenBalenaDataProvider,
  record: ResourceRecord,
  choice: Choice,
): Promise<ResolvedDeviceActionTarget> => {
  if (typeof choice.targetVersion !== 'string' || !choice.targetVersion.trim())
    throw new Error('The selected Supervisor release has no version.');
  const deviceId = Number(record.id);
  if (!Number.isSafeInteger(deviceId) || deviceId <= 0) throw new Error('The device ID is invalid.');
  const result = await dataProvider.setDeviceSupervisorTarget({
    deviceId,
    version: choice.targetVersion,
  });
  if (
    !result ||
    typeof result !== 'object' ||
    !Number.isSafeInteger(result.releaseId) ||
    result.releaseId <= 0 ||
    typeof result.version !== 'string' ||
    result.version !== choice.targetVersion
  )
    throw new Error('The Supervisor target response is invalid.');
  return { targetReleaseId: result.releaseId, targetVersion: result.version };
};

export const UnsupportedDeviceField: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Tooltip title='This field is available in Balena Cloud but is not exposed by open-balena-api.' arrow>
    <span>{children}</span>
  </Tooltip>
);
