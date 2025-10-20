import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopIcon from '@mui/icons-material/Stop';
import TripOriginIcon from '@mui/icons-material/TripOrigin';
import { Button, useTheme } from '@mui/material';
import React from 'react';
import {
  Datagrid,
  FunctionField,
  ReferenceField,
  ReferenceManyField,
  TextField,
  Toolbar,
  WithRecord,
  useAuthProvider,
  useNotify,
  useRecordContext,
} from 'react-admin';
import utf8decode from '../lib/utf8decode';
import SemVerChip from './SemVerChip';
import environment from '../lib/reactAppEnv';
import type { ResourceRecord } from '../types/resource';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';

interface DeviceServicesProps {
  device: ResourceRecord;
}

type ServiceRecord = ResourceRecord & {
  status?: string;
  ['installs-image']?: number | string;
};

export const DeviceServices: React.FC<DeviceServicesProps> = ({ device }) => {
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const notify = useNotify();
  const record = useRecordContext<ResourceRecord>();
  const theme = useTheme();

  const [isExecutingCommand, setIsExecutingCommand] = React.useState(false);

  const invokeSupervisor = React.useCallback(
    async (imageInstall: ServiceRecord, command: 'start' | 'stop' | 'restart') => {
      const session: OpenBalenaSession | undefined = authProvider?.getSession?.();
      if (!session?.jwt) {
        notify('Error: Unable to execute command without a valid session', { type: 'error' });
        return;
      }

      const imageId = imageInstall['installs-image'];
      if (!imageId) {
        notify('Error: Missing image identifier for service command', { type: 'error' });
        return;
      }

      const applicationId = device['belongs to-application'];
      const deviceUuid = device.uuid;
      const deviceName = String(device['device name'] ?? 'device');

      if (!applicationId || !deviceUuid) {
        notify('Error: Missing device context for service command', { type: 'error' });
        return;
      }

      setIsExecutingCommand(true);

      try {
        const response = await fetch(
          `${environment.REACT_APP_OPEN_BALENA_API_URL}/supervisor/v2/applications/${applicationId}/${command}-service`,
          {
            method: 'POST',
            body: JSON.stringify({ uuid: deviceUuid, data: { imageId } }),
            headers: new Headers({
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.jwt}`,
            }),
            insecureHTTPParser: true,
          },
        );

        if (!response.ok) {
          throw new Error(response.statusText);
        }

        const body = response.body;
        if (!body) {
          return;
        }

        const streamData = await body.getReader().read();
        if (streamData.value) {
          const result = utf8decode(streamData.value);
          if (result === 'OK') {
            notify(`Successfully executed command ${command} on device ${deviceName}`, {
              type: 'success',
            });
          }
        }
      } catch (error) {
        notify(`Error: Could not execute command ${command} on device ${deviceName}`, { type: 'error' });
      } finally {
        setIsExecutingCommand(false);
      }
    },
    [authProvider, device, notify],
  );

  if (!record) {
    return null;
  }

  return (
    <ReferenceManyField
      source='id'
      reference='image install'
      target='device'
      filter={record['is running-release'] ? { 'is provided by-release': record['is running-release'] } : {}}
    >
      <Datagrid bulkActionButtons={false}>
        <WithRecord
          render={(service) => {
            const color =
              service.status === 'Running'
                ? theme.palette.success.light
                : service.status === 'Error'
                  ? theme.palette.error.light
                  : theme.palette.warning.light;

            return <TripOriginIcon sx={{ color }} />;
          }}
        />

        <ReferenceField label='Image' source='installs-image' reference='image' target='id' link={false}>
          <ReferenceField
            label='Image'
            source='is a build of-service'
            reference='service'
            target='id'
            link={(record, reference) => `/${reference}/${record['is a build of-service']}`}
          >
            <TextField source='service name' />
          </ReferenceField>
        </ReferenceField>

        <TextField label='Status' source='status' />

        <ReferenceField label='Release' source='is provided by-release' reference='release' target='id'>
          <SemVerChip />
        </ReferenceField>

        <FunctionField
          render={(serviceRecord: ServiceRecord) => {
            const isRunning = serviceRecord.status?.toLowerCase() === 'running';

            return (
              <Toolbar style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}>
                <Button
                  onClick={() => invokeSupervisor(serviceRecord, 'start')}
                  disabled={isRunning || isExecutingCommand}
                  variant={'text'}
                  sx={{ p: '4px', m: '4px', minWidth: 0 }}
                >
                  <PlayArrowIcon />
                </Button>

                <Button
                  onClick={() => invokeSupervisor(serviceRecord, 'stop')}
                  disabled={!isRunning || isExecutingCommand}
                  variant={'text'}
                  sx={{ p: '4px', m: '4px', minWidth: 0 }}
                >
                  <StopIcon />
                </Button>

                <Button
                  onClick={() => invokeSupervisor(serviceRecord, 'restart')}
                  disabled={isExecutingCommand}
                  variant={'text'}
                  sx={{ p: '4px', m: '4px', minWidth: 0 }}
                >
                  <RestartAltIcon />
                </Button>
              </Toolbar>
            );
          }}
        />
      </Datagrid>
    </ReferenceManyField>
  );
};

export default DeviceServices;
