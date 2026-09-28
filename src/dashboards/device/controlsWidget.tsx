import React from 'react';
import LightModeIcon from '@mui/icons-material/LightMode';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, CardActions, Typography } from '@mui/material';
import { FunctionField, ReferenceField, TextField, useAuthProvider, useNotify, useRecordContext } from 'react-admin';
import { OnlineField } from '../../components/device';
import { useReconcileDeviceServices } from '../../lib/device';
import environment from '../../lib/reactAppEnv';
import utf8decode from '../../lib/utf8decode';
import { ConfirmationDialog, type ConfirmationDialogProps } from '../../ui/ConfirmationDialog';
import type { RaRecord } from 'react-admin';
import { deviceOnlineStatusField, isDeviceOnline } from '../../lib/deviceStatus';
import { DeviceFieldEditor, loadFleetChoices } from '../../ui/DeviceFieldEditor';
import { HeartbeatStatusIcon, VpnStatusIcon } from '../../ui/DeviceConnectivityStatusIcon';
import versions from '../../versions';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

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

type DeviceRecord = RaRecord & {
  'uuid': string;
  'device name': string;
  'api heartbeat state'?: string;
  'is connected to vpn'?: boolean;
  'last connectivity event'?: string;
  'changed api heartbeat state on-date'?: string;
  'note'?: string;
};

const ControlsWidget: React.FC = () => {
  const authProvider = useAuthProvider();
  const notify = useNotify();
  const record = useRecordContext<DeviceRecord>();
  const reconcileDeviceServices = useReconcileDeviceServices();

  const [confirmationDialog, setConfirmationDialog] = React.useState<ConfirmationDialogProps | null>(null);

  const invokeSupervisor = React.useCallback(
    async (device: DeviceRecord, command: string) => {
      const session = authProvider?.getSession?.();
      if (!session?.jwt) {
        notify('Error: Unable to execute command without a valid session', { type: 'error' });
        return;
      }

      try {
        const response = await fetch(`${environment.REACT_APP_OPEN_BALENA_API_URL}/supervisor/v1/${command}`, {
          method: 'POST',
          body: JSON.stringify({ uuid: device.uuid }),
          headers: new Headers({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.jwt}`,
          }),
          insecureHTTPParser: true,
        });

        if (response.status < 200 || response.status >= 300) {
          throw new Error(response.statusText);
        }

        const body = response.body;
        if (!body) {
          return;
        }

        const streamData = await body.getReader().read();
        if (!streamData.value) {
          return;
        }

        const result = utf8decode(streamData.value);
        if (result === 'OK') {
          notify(`Successfully executed command ${command} on device ${device['device name']}`, {
            type: 'success',
          });
        }
      } catch (error) {
        notify(`Error: Could not execute command ${command} on device ${device['device name']}`, { type: 'error' });
      }
    },
    [authProvider, notify],
  );

  if (!record) return null;

  return (
    <>
      <Typography variant='h4' component='h2' gutterBottom>
        {record['device name']}
        <DeviceFieldEditor
          source='device name'
          title='Device name'
          currentValue={record['device name']}
          required
          iconOnly
        />
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'minmax(0, 1.25fr) minmax(0, 1fr) minmax(max-content, 0.75fr)',
            lg: 'repeat(4, minmax(0, 1fr))',
          },
          columnGap: 4,
          rowGap: 1,
        }}
      >
        <Box>
          <b>
            Fleet
            <DeviceFieldEditor
              source='belongs to-application'
              title='Fleet'
              currentValue={record['belongs to-application']}
              required
              iconOnly
              loadChoices={loadFleetChoices}
              updateData={(applicationId) => ({
                'belongs to-application': applicationId,
                [isPinnedOnRelease]: null,
              })}
              onUpdated={(applicationId) => reconcileDeviceServices(record.id, applicationId as number | string)}
            />
            :{' '}
          </b>
          <ReferenceField source='belongs to-application' reference='application'>
            <TextField source='app name' style={{ fontSize: '12pt' }} />
          </ReferenceField>
        </Box>

        <Box>
          <b>Status: </b>
          <OnlineField source={deviceOnlineStatusField} />
        </Box>

        <Box
          sx={{
            display: { xs: 'flex', lg: 'contents' },
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <b>Heartbeat:</b>
            <FunctionField render={(fieldRecord) => <HeartbeatStatusIcon record={fieldRecord} />} />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <b>VPN:</b>
            <FunctionField render={(fieldRecord) => <VpnStatusIcon record={fieldRecord} />} />
          </Box>
        </Box>

        {record.note && (
          <Box sx={{ gridColumn: '1 / -1', whiteSpace: 'pre-wrap' }}>
            <b>Note: </b>
            {record.note}
          </Box>
        )}
      </Box>

      <CardActions sx={styles.actionCard}>
        <FunctionField
          render={(fieldRecord: DeviceRecord) => {
            const isOffline = fieldRecord['is connected to vpn'] !== true;

            return (
              <>
                {!isOffline && (
                  <>
                    <Button
                      variant='outlined'
                      size='medium'
                      onClick={() => invokeSupervisor(fieldRecord, 'blink')}
                      startIcon={<LightModeIcon />}
                    >
                      Blink
                    </Button>

                    <Button
                      variant='outlined'
                      size='medium'
                      startIcon={<RestartAltIcon />}
                      onClick={() => {
                        setConfirmationDialog({
                          title: 'Reboot Device',
                          content: 'Are you sure you want to reboot this device?',
                          onConfirm: () => invokeSupervisor(fieldRecord, 'reboot'),
                        });
                      }}
                    >
                      Reboot
                    </Button>

                    <Button
                      variant='outlined'
                      size='medium'
                      startIcon={<PowerSettingsNewIcon />}
                      onClick={() => {
                        setConfirmationDialog({
                          title: 'Shutdown Device',
                          content: 'Are you sure you want to shut down this device?',
                          onConfirm: () => invokeSupervisor(fieldRecord, 'shutdown'),
                        });
                      }}
                    >
                      Shutdown
                    </Button>
                  </>
                )}
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
