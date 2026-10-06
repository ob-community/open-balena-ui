import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { HttpError, useAuthProvider, useRecordContext } from 'react-admin';
import environment from '../lib/reactAppEnv';
import { withPermissionHint } from '../lib/httpErrorMessage';
import type { ResourceRecord } from '../types/resource';
import type { OpenBalenaAuthProvider } from '../authProvider/openbalenaAuthProvider';
import { deviceServiceLogSource, type DeviceLogServiceSelection } from '../lib/deviceServicePresentation';
import {
  clearLogBuffer,
  exportDeviceLogs,
  logFontFamily,
  logPollIntervalMs,
  logSeverity,
  mergeLogSnapshot,
  parseDeviceLogs,
  parseLogText,
  plainLogMessage,
  selectedLogSources,
  type DeviceLogBuffer,
} from '../lib/deviceLogs';
import { matchesLogFilters, type LogFilterGroup } from '../lib/deviceLogFilters';
import { DeviceLogFilters } from './DeviceLogFilters';
import { useDeviceLogSelection } from './DeviceLogSelection';
import { ServiceBadge } from './ServiceBadge';
import { useDeviceServicePresentation } from './useDeviceServicePresentation';

type DeviceRecord = ResourceRecord & { uuid: string };

const SourceMenu: React.FC<{ label: string; choices: DeviceLogServiceSelection[] }> = ({ label, choices }) => {
  const { selected, setSelected, toggle } = useDeviceLogSelection();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const count = choices.filter((choice) => selected.some(({ serviceId }) => serviceId === choice.serviceId)).length;
  const all = choices.length > 0 && count === choices.length;
  return (
    <Stack direction='row' alignItems='center'>
      <Checkbox
        size='small'
        checked={all}
        indeterminate={count > 0 && !all}
        disabled={!choices.length}
        inputProps={{
          'aria-label': `Toggle all ${label} logs`,
          'aria-checked': count > 0 && !all ? 'mixed' : all,
        }}
        onChange={() =>
          setSelected((current) =>
            all
              ? current.filter((choice) => !choices.some(({ serviceId }) => serviceId === choice.serviceId))
              : [
                  ...current,
                  ...choices.filter((choice) => !current.some(({ serviceId }) => serviceId === choice.serviceId)),
                ],
          )
        }
      />
      <Button
        size='small'
        variant='text'
        endIcon={<ExpandMoreIcon />}
        aria-label={`${label} log sources`}
        aria-haspopup='menu'
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ minWidth: 0, px: 0.5 }}
      >
        {label}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setSelected([]);
            setAnchor(null);
          }}
        >
          Select Container (clear selection)
        </MenuItem>
        {choices.map((choice) => {
          const checked = selected.some(({ serviceId }) => serviceId === choice.serviceId);
          return (
            <MenuItem
              key={choice.serviceId}
              role='menuitemcheckbox'
              aria-checked={checked}
              onClick={() => toggle(choice)}
            >
              <Checkbox size='small' checked={checked} tabIndex={-1} disableRipple />
              <ServiceBadge name={choice.serviceName} />
            </MenuItem>
          );
        })}
      </Menu>
    </Stack>
  );
};

export const DeviceLogs: React.FC = () => {
  const record = useRecordContext<DeviceRecord>();
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const presentation = useDeviceServicePresentation(record);
  const { selected } = useDeviceLogSelection();
  const [buffer, setBuffer] = React.useState<DeviceLogBuffer>({ entries: [] });
  const [search, setSearch] = React.useState('');
  const [filters, setFilters] = React.useState<LogFilterGroup[]>([]);
  const [error, setError] = React.useState('');
  const logsContainerRef = React.useRef<HTMLDivElement>(null);
  const follow = React.useRef(true);
  const active = selected.length > 0;
  const uuid = record?.uuid;
  const theme = useTheme();
  const choice = (service: (typeof presentation.services)[number]): DeviceLogServiceSelection[] => {
    const serviceId = Number(service.serviceId);
    return Number.isSafeInteger(serviceId) && serviceId > 0
      ? [
          {
            serviceId,
            serviceName: service.serviceName,
            logSource: deviceServiceLogSource(service),
            serviceGroup: service.serviceGroup,
          },
        ]
      : [];
  };
  const distinct = (choices: DeviceLogServiceSelection[]) =>
    choices.filter((entry, index) => choices.findIndex(({ serviceId }) => serviceId === entry.serviceId) === index);
  const appChoices = distinct(presentation.appServices.flatMap(choice));
  const supervisorChoices = distinct([
    { serviceId: 0, serviceName: 'Host OS', serviceGroup: 'supervisor' },
    ...presentation.supervisorServices.flatMap(choice),
  ]);
  for (const source of selected) {
    if ([...appChoices, ...supervisorChoices].some(({ serviceId }) => serviceId === source.serviceId)) continue;
    // Keep selected services reachable when the device changes releases or an API relationship disappears.
    const group =
      source.serviceGroup === 'supervisor' || source.logSource === 'supervisor' ? supervisorChoices : appChoices;
    group.push(source);
  }

  React.useEffect(() => {
    setBuffer({ entries: [] });
    setSearch('');
    setFilters([]);
  }, [uuid]);

  React.useEffect(() => {
    setError('');
    if (!active || !uuid) {
      setBuffer((current) => ({ entries: [], after: current.after }));
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastFailure = '';
    const poll = async () => {
      try {
        const token = authProvider?.getSession().jwt;
        if (!token) throw new Error('Unable to fetch logs without a valid session.');
        const response = await fetch(`${environment.REACT_APP_OPEN_BALENA_API_URL}/device/v2/${uuid}/logs`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new HttpError(response.statusText, response.status);
        const snapshot = parseDeviceLogs(await response.json());
        if (controller.signal.aborted) return;
        setBuffer((current) => mergeLogSnapshot(current, snapshot));
        setError('');
        lastFailure = '';
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message = withPermissionHint(
          `Could not get device logs: ${failure instanceof Error ? failure.message : 'Unknown error'}`,
          failure instanceof HttpError ? failure.status : undefined,
        );
        if (message !== lastFailure) console.error('Device log polling failed:', failure);
        lastFailure = message;
        setError(message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), logPollIntervalMs);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, uuid, authProvider]);

  const visible = active
    ? buffer.entries.filter(
        (entry) =>
          selectedLogSources(entry, selected).length > 0 &&
          matchesLogFilters({ ...entry, message: plainLogMessage(entry.message) }, filters, search),
      )
    : [];
  React.useEffect(() => {
    if (follow.current && logsContainerRef.current)
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [buffer, search, filters, selected]);

  if (!record) return null;
  const palette = theme.palette.logs;
  const background = palette?.background ?? (theme.palette.mode === 'dark' ? '#0d1a26' : '#343434');
  const foreground = palette?.text?.default ?? '#eeeeee';
  const colors = {
    default: foreground,
    error: palette?.text?.error ?? '#ee6666',
    warning: palette?.text?.warning ?? '#ffee66',
    info: '#8ed08c',
    debug: '#a0ceff',
  };
  const download = () => {
    const blob = new Blob([exportDeviceLogs(visible, selected)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const name = String(record['device name'] ?? uuid).replace(/[^A-Za-z0-9_.-]/g, '_');
    anchor.download = `${name}-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <>
      {presentation.error && <Alert severity='error'>Unable to load log sources: {presentation.error.message}</Alert>}
      {presentation.isPending && <LinearProgress aria-label='Loading log sources' />}
      <Stack direction='row' alignItems='center' flexWrap='wrap' sx={{ px: 1.5, py: 0.5 }}>
        <Typography variant='subtitle2' sx={{ flex: 1 }}>
          Logs
        </Typography>
        <SourceMenu label='App' choices={appChoices} />
        <SourceMenu label='Supervisor' choices={supervisorChoices} />
        <Tooltip title='Download displayed logs'>
          <span>
            <IconButton size='small' aria-label='Download displayed logs' disabled={!visible.length} onClick={download}>
              <DownloadIcon fontSize='small' />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title='Clear logs; show only subsequent entries'>
          <span>
            <IconButton
              size='small'
              aria-label='Clear logs'
              disabled={!active}
              onClick={() => {
                follow.current = true;
                setBuffer((current) => clearLogBuffer(current));
              }}
            >
              <DeleteOutlineIcon fontSize='small' />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <DeviceLogFilters search={search} onSearchChange={setSearch} filters={filters} onFiltersChange={setFilters} />
      {error && <Alert severity='error'>{error}</Alert>}
      <Box
        ref={logsContainerRef}
        role='log'
        aria-label='Device log contents'
        aria-live='off'
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 30;
        }}
        sx={{
          'm': 0,
          'p': 1.5,
          'height': 'min(500px, 60vh)',
          'minHeight': 300,
          'maxHeight': 500,
          'overflow': 'auto',
          'color': foreground,
          'backgroundColor': background,
          'fontSize': '0.85rem',
          'lineHeight': 1.5,
          'whiteSpace': 'pre-wrap',
          'overflowWrap': 'anywhere',
          '&, & *': { fontFamily: `${logFontFamily} !important` },
        }}
      >
        {!active ? (
          <Typography variant='body2'>No services selected. Select a log source to see logs.</Typography>
        ) : !visible.length ? (
          <Typography variant='body2'>No matching logs.</Typography>
        ) : (
          visible.map((entry) => (
            <Box key={entry.key}>
              <Box component='span' sx={{ color: foreground }}>
                [{entry.timestamp}]{' '}
              </Box>
              {selectedLogSources(entry, selected).map(({ serviceId, serviceName }) => (
                <React.Fragment key={serviceId}>
                  <ServiceBadge name={serviceName} />{' '}
                </React.Fragment>
              ))}
              <Box component='span' sx={{ color: colors[logSeverity(entry)] }}>
                {parseLogText(entry.message).map((segment, index) => (
                  <Box component='span' key={index} sx={segment.style}>
                    {segment.text}
                  </Box>
                ))}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </>
  );
};

export default DeviceLogs;
