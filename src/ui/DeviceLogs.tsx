import { Box, useTheme } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import React from 'react';
import { Form, SelectInput, useAuthProvider, useDataProvider, useRecordContext, useNotify } from 'react-admin';
import type { DataProvider } from 'react-admin';
import environment from '../lib/reactAppEnv';
import type { ResourceRecord } from '../types/resource';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';

interface ContainerChoice {
  id: number;
  name: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  isStdErr?: boolean;
  isSystem?: boolean;
  serviceId?: number;
}

type DeviceRecord = ResourceRecord & {
  uuid: string;
};

const ansiEscapeSequence = /\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[=>])/g;

const normalizeLogMessage = (message: string): string =>
  message.replace(ansiEscapeSequence, '').replace(/\r\n?/g, '\n');

export const DeviceLogs: React.FC = () => {
  const record = useRecordContext<DeviceRecord>();
  const [loaded, setLoaded] = React.useState(false);
  const [containers, setContainers] = React.useState<ContainerChoice[]>([]);
  const [container, setContainer] = React.useState<number | 'default'>('default');
  const [content, setContent] = React.useState<LogEntry[]>([]);
  const logsContainerRef = React.useRef<HTMLPreElement>(null);
  const dataProvider = useDataProvider<DataProvider>();
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const notify = useNotify();
  const theme = useTheme();

  // Get logs colors from theme palette
  const logsPalette = theme.palette.logs;
  const logsBgColor = logsPalette?.background ?? (theme.palette.mode === 'dark' ? '#0d1a26' : '#343434');
  const logsTextColor = logsPalette?.text?.default ?? '#eeeeee';
  const logsErrorColor = logsPalette?.text?.error ?? '#ee6666';
  const logsWarningColor = logsPalette?.text?.warning ?? '#ffee66';

  const fetchLogs = React.useCallback(async (): Promise<LogEntry[]> => {
    if (!record) {
      throw new Error('Device record is not available');
    }

    const session: OpenBalenaSession | undefined = authProvider?.getSession?.();
    if (!session?.jwt) {
      throw new Error('Unable to fetch logs without a valid session');
    }

    const apiHost = environment.REACT_APP_OPEN_BALENA_API_URL;
    const response = await fetch(`${apiHost}/device/v2/${record.uuid}/logs`, {
      method: 'GET',
      headers: new Headers({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.jwt}`,
      }),
      insecureHTTPParser: true,
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    return (await response.json()) as LogEntry[];
  }, [authProvider, record]);

  const updateLogs = React.useCallback(async () => {
    if (container === 'default') {
      return;
    }

    try {
      const logs = await fetchLogs();
      if (!logs?.length) {
        setContent([]);
        return;
      }

      const filteredLogs = logs.filter((entry) => {
        if (container === 0) {
          return !Object.prototype.hasOwnProperty.call(entry, 'serviceId') || entry.serviceId == null;
        }

        return Number(entry.serviceId) === Number(container);
      });

      if (!filteredLogs.length) {
        setContent([]);
        return;
      }

      setContent(
        filteredLogs.map((entry) => ({
          ...entry,
          message: normalizeLogMessage(entry.message ?? ''),
        })),
      );
    } catch (error) {
      console.error(error);
      if (record?.uuid) {
        notify(`Error: Could not get logs for device ${record.uuid}`, { type: 'error' });
      }
    }
  }, [container, fetchLogs, notify, record]);

  React.useEffect(() => {
    if (container === 'default') {
      return;
    }

    void updateLogs();
  }, [container, updateLogs]);

  React.useEffect(() => {
    const logsContainer = logsContainerRef.current;
    if (logsContainer) {
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }
  }, [content]);

  React.useEffect(() => {
    if (loaded || !record) {
      return;
    }

    const loadContainers = async () => {
      try {
        const installs = await dataProvider.getList<ResourceRecord>('image install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { device: record.id, status: 'Running' },
        });

        const choices: ContainerChoice[] = [{ id: 0, name: 'host' }];

        for (const install of installs.data) {
          const imageId = install['installs-image'];
          if (!imageId) {
            continue;
          }

          const images = await dataProvider.getList<ResourceRecord>('image', {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { id: imageId },
          });

          const imageRecord = images.data[0];
          if (!imageRecord) {
            continue;
          }

          const serviceId = imageRecord['is a build of-service'];
          if (!serviceId) {
            continue;
          }

          const services = await dataProvider.getList<ResourceRecord>('service', {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { id: serviceId },
          });

          const serviceRecord = services.data[0];
          if (!serviceRecord) {
            continue;
          }

          const idValue = typeof serviceRecord.id === 'number' ? serviceRecord.id : Number(serviceRecord.id);
          const nameValue = String(serviceRecord['service name'] ?? '');

          if (!Number.isNaN(idValue) && nameValue) {
            choices.push({ id: idValue, name: nameValue });
          }
        }

        setContainers(choices);
      } catch (error) {
        console.error(error);
        setContainers([{ id: 0, name: 'host' }]);
      } finally {
        setLoaded(true);
      }
    };

    void loadContainers();
  }, [dataProvider, loaded, record]);

  if (!record) {
    return null;
  }

  return (
    <>
      <Form>
        <Box
          sx={{
            'display': 'flex',
            'padding': '5px 15px',
            'alignItems': 'center',
            '.MuiFormHelperText-root, .MuiFormLabel-root': {
              display: 'none',
            },
            '.MuiOutlinedInput-root': {
              height: '35px',
            },
            '.MuiSelect-select': {
              padding: '9px 14px',
            },
          }}
        >
          <strong style={{ flex: 1 }}>Logs</strong>

          <SelectInput
            source='container'
            disabled={containers.length === 0}
            choices={containers}
            defaultValue='default'
            emptyText='Select Container'
            emptyValue='default'
            size='small'
            label=''
            onChange={(event) => {
              const value = event.target.value;

              if (value === 'default') {
                setContainer('default');
                return;
              }

              if (typeof value === 'number') {
                setContainer(value);
                return;
              }

              const numericValue = Number(value);
              setContainer(Number.isNaN(numericValue) ? 'default' : numericValue);
            }}
          />

          <IconButton
            disabled={container === 'default'}
            size='small'
            sx={{ ml: '10px' }}
            onClick={() => {
              void updateLogs();
            }}
          >
            <RefreshIcon />
          </IconButton>
        </Box>
      </Form>

      <Box
        ref={logsContainerRef}
        component='pre'
        sx={{
          m: 0,
          p: '10px',
          height: 'min(500px, 60vh)',
          minHeight: '300px',
          maxHeight: '500px',
          overflowY: 'auto',
          overflowX: 'auto',
          color: logsTextColor,
          backgroundColor: logsBgColor,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.85rem',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {content.map((entry, index) => {
          const color = entry.isStdErr ? logsErrorColor : entry.isSystem ? logsWarningColor : logsTextColor;
          const parsedTimestamp = new Date(entry.timestamp);
          const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? entry.timestamp : parsedTimestamp.toISOString();

          return (
            <Box component='div' key={`${entry.timestamp}-${index}`}>
              <Box component='span' sx={{ color: logsTextColor }}>
                [{timestamp}]{' '}
              </Box>
              <Box component='span' sx={{ color }}>
                {entry.message}
              </Box>
            </Box>
          );
        })}
      </Box>
    </>
  );
};

export default DeviceLogs;
