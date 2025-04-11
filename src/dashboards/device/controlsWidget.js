import React from 'react';
import LightModeIcon from '@mui/icons-material/LightMode';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, CardActions, Typography } from '@mui/material';
import {
  EditButton,
  FunctionField,
  ReferenceField,
  TextField,
  useAuthProvider,
  useNotify,
  useRecordContext,
} from 'react-admin';
import { OnlineField } from '../../components/device';
import utf8decode from '../../lib/utf8decode';
import environment from '../../lib/reactAppEnv';
import { ConfirmationDialog } from '../../ui/ConfirmationDialog';

const styles = {
  actionCard: {
    'padding': 0,
    'flexWrap': 'wrap',
    '& .MuiButton-root': {
      'marginTop': '2em',
      'marginRight': '1em',

      '.MuiButton-icon': {
        marginRight: '6px !important',
      },
    },
  },
};

const ControlsWidget = () => {
  const authProvider = useAuthProvider();
  const notify = useNotify();
  const record = useRecordContext();

  const [confirmationDialog, setConfirmationDialog] = React.useState(null);

  const invokeSupervisor = (device, command) => {
    const session = authProvider.getSession();
    return fetch(`${environment.REACT_APP_OPEN_BALENA_API_URL}/supervisor/v1/${command}`, {
      method: 'POST',
      body: JSON.stringify({ uuid: device.uuid }),
      headers: new Headers({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.jwt}`,
      }),
      insecureHTTPParser: true,
    })
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
      });
  };

  if (!record) return null;

  return (
    <>
      <Typography variant='h5' component='h2' gutterBottom>
        {record['device name']}
      </Typography>

      <Box maxWidth='40em'>
        <p style={{ marginBottom: '5px' }}>
          <b>Fleet: </b>
          <ReferenceField source='belongs to-application' reference='application' target='id'>
            <TextField source='app name' style={{ fontSize: '12pt' }} />
          </ReferenceField>
        </p>

        <p style={{ margin: 0 }}>
          <b>Status: </b>
          <OnlineField source='api heartbeat state' />
        </p>
      </Box>

      <CardActions sx={styles.actionCard}>
        <FunctionField
          render={(record) => {
            const isOffline = record['api heartbeat state'] !== 'online';

            return (
              <>
                <EditButton label='Edit' size='medium' variant='outlined' color='secondary' />

                <Button
                  variant='outlined'
                  size='medium'
                  onClick={() => invokeSupervisor(record, 'blink')}
                  startIcon={<LightModeIcon />}
                  disabled={isOffline}
                >
                  Blink
                </Button>

                <Button
                  variant='outlined'
                  size='medium'
                  startIcon={<RestartAltIcon />}
                  disabled={isOffline}
                  onClick={() => {
                    setConfirmationDialog({
                      title: 'Reboot Device',
                      message: 'Are you sure you want to reboot this device?',
                      confirmText: 'Reboot',
                      onConfirm: () => invokeSupervisor(record, 'reboot'),
                    });
                  }}
                >
                  Reboot
                </Button>

                <Button
                  variant='outlined'
                  size='medium'
                  startIcon={<PowerSettingsNewIcon />}
                  disabled={isOffline}
                  onClick={() => {
                    setConfirmationDialog({
                      title: 'Shutdown Device',
                      message: 'Are you sure you want to shut down this device?',
                      confirmText: 'Shutdown',
                      onConfirm: () => invokeSupervisor(record, 'shutdown'),
                    });
                  }}
                >
                  Shutdown
                </Button>
              </>
            );
          }}
        />
      </CardActions>

      {!!confirmationDialog && (
        <ConfirmationDialog {...confirmationDialog} onClose={() => setConfirmationDialog(null)} />
      )}
    </>
  );
};

export default ControlsWidget;
