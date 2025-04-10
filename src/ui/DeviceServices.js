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

export const DeviceServices = (props) => {
  const authProvider = useAuthProvider();
  const notify = useNotify();
  const record = useRecordContext();
  const theme = useTheme();

  const [isExecutingCommand, setIsExecutingCommand] = React.useState(false);

  const invokeSupervisor = (imageInstall, command) => {
    const session = authProvider.getSession();
    const { device } = props;

    setIsExecutingCommand(true);

    return fetch(
      `${environment.REACT_APP_OPEN_BALENA_API_URL}/supervisor/v2/applications/${device['belongs to-application']}/${command}-service`,
      {
        method: 'POST',
        body: JSON.stringify({ uuid: device.uuid, data: { imageId: imageInstall['installs-image'] } }),
        headers: new Headers({
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.jwt}`,
        }),
        insecureHTTPParser: true,
      },
    )
      .then((response) => {
        if (response.status < 200 || response.status >= 300) {
          throw new Error(response.statusText);
        }

        return response.body
          .getReader()
          .read()
          .then((streamData) => {
            const result = utf8decode(streamData.value);
            if (result === 'OK')
              notify(`Successfully executed command ${command} on device ${device['device name']}`, {
                type: 'success',
              });
          });
      })
      .catch(() => {
        notify(`Error: Could not execute command ${command} on device ${device['device name']}`, { type: 'error' });
      })
      .finally(() => setIsExecutingCommand(false));
  };

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
          render={(record) => {
            const isRunning = record.status?.toLowerCase() === 'running';

            return (
              <Toolbar style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}>
                <Button
                  onClick={() => invokeSupervisor(record, 'start')}
                  disabled={isRunning || isExecutingCommand}
                  variant={'text'}
                  sx={{ p: '4px', m: '4px', minWidth: 0 }}
                >
                  <PlayArrowIcon />
                </Button>

                <Button
                  onClick={() => invokeSupervisor(record, 'stop')}
                  disabled={!isRunning || isExecutingCommand}
                  variant={'text'}
                  sx={{ p: '4px', m: '4px', minWidth: 0 }}
                >
                  <StopIcon />
                </Button>

                <Button
                  onClick={() => invokeSupervisor(record, 'restart')}
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
