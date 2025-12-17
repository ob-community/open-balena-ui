import { Box, useTheme } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import React from 'react';
import { Form, SelectInput, useAuthProvider, useDataProvider, useRecordContext, useNotify } from 'react-admin';
import type { DataProvider } from 'react-admin';
import environment from '../lib/reactAppEnv';
import type { ResourceRecord } from '../types/resource';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';
import { EmbeddedFrame } from './EmbeddedFrame';

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

export const DeviceLogs: React.FC = () => {
  const record = useRecordContext<DeviceRecord>();
  const [loaded, setLoaded] = React.useState(false);
  const [containers, setContainers] = React.useState<ContainerChoice[]>([]);
  const [container, setContainer] = React.useState<number | 'default'>('default');
  const [content, setContent] = React.useState('');
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

  // Generate empty shell HTML with proper background
  const emptyLogsHtml = React.useMemo(
    () =>
      `<html><body style='font-family: consolas; color: ${logsTextColor}; background-color: ${logsBgColor}; margin: 0; padding: 10px;'></body></html>`,
    [logsBgColor, logsTextColor],
  );

  // Use empty shell when no content
  const displayContent = content || emptyLogsHtml;

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
        setContent('');
        return;
      }

      const filteredLogs = logs.filter((entry) => {
        if (container === 0) {
          return !Object.prototype.hasOwnProperty.call(entry, 'serviceId') || entry.serviceId == null;
        }

        return Number(entry.serviceId) === Number(container);
      });

      if (!filteredLogs.length) {
        setContent('');
        return;
      }

      const formattedLogs = filteredLogs
        .map((entry) => {
          const time = new Date(entry.timestamp).toISOString();
          const message = entry.message ?? '';

          if (entry.isStdErr) {
            return `[${time}] <span style="color: ${logsErrorColor}; ">${message}</span>`;
          }

          if (entry.isSystem) {
            return `[${time}] <span style="color: ${logsWarningColor}; ">${message}</span>`;
          }

          return `[${time}] ${message}`;
        })
        .join('<br/>');

      setContent(
        `<html>
          <body style='font-family: consolas; color: ${logsTextColor}; background-color: ${logsBgColor}; margin: 0; padding: 10px;'>
            <div>${formattedLogs}</div>
            <script>window.scrollTo(0, document.body.scrollHeight);</script>
          </body>
        </html>`,
      );
    } catch (error) {
      console.error(error);
      if (record?.uuid) {
        notify(`Error: Could not get logs for device ${record.uuid}`, { type: 'error' });
      }
    }
  }, [container, fetchLogs, logsBgColor, logsTextColor, logsErrorColor, logsWarningColor, notify, record]);

  React.useEffect(() => {
    if (container === 'default') {
      return;
    }

    void updateLogs();
  }, [container, updateLogs]);

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

      <EmbeddedFrame srcDoc={displayContent} backgroundColor={logsBgColor} />
    </>
  );
};

export default DeviceLogs;
