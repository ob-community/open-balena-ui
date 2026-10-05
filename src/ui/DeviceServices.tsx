import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopIcon from '@mui/icons-material/Stop';
import TripOriginIcon from '@mui/icons-material/TripOrigin';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import SpeakerNotesOffOutlinedIcon from '@mui/icons-material/SpeakerNotesOffOutlined';
import { Alert, Box, Button, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import React from 'react';
import { Link } from 'react-router-dom';
import {
  Datagrid,
  FunctionField,
  HttpError,
  ReferenceField,
  ListContextProvider,
  TextField,
  Toolbar,
  WithRecord,
  useAuthProvider,
  useList,
  useNotify,
  useRecordContext,
} from 'react-admin';
import { withPermissionHint } from '../lib/httpErrorMessage';
import SemVerChip from './SemVerChip';
import environment from '../lib/reactAppEnv';
import type { ResourceRecord } from '../types/resource';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';
import { deviceServiceLogSource, relationshipId, type PresentedDeviceService } from '../lib/deviceServicePresentation';
import { ServiceBadge } from './ServiceBadge';
import { useDeviceServicePresentation } from './useDeviceServicePresentation';
import { useDeviceLogSelection } from './DeviceLogSelection';
import { refreshDeviceStateQueries, useDeviceRefreshActions } from './useDeviceRefreshActions';
import { useQueryClient } from '@tanstack/react-query';

interface DeviceServicesProps {
  device: ResourceRecord;
  showLogSelection?: boolean;
}

type ServiceRecord = ResourceRecord & {
  status?: string;
};

const ServiceLogsButton: React.FC<{ imageInstall: PresentedDeviceService }> = ({ imageInstall }) => {
  const { serviceId, serviceName } = imageInstall;
  const numericServiceId = typeof serviceId === 'number' ? serviceId : Number(serviceId);
  const canSelect = Number.isFinite(numericServiceId);
  const selection = useDeviceLogSelection();
  const selected = selection.selected.some(({ serviceId }) => serviceId === numericServiceId);
  const label = `${selected ? 'Disable' : 'Enable'} ${serviceName} logs`;

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          aria-label={label}
          aria-pressed={selected}
          disabled={!canSelect}
          size='small'
          onClick={(event) => {
            event.stopPropagation();
            selection.toggle({
              serviceId: numericServiceId,
              serviceName,
              logSource: deviceServiceLogSource(imageInstall),
              serviceGroup: imageInstall.serviceGroup,
            });
          }}
        >
          {selected ? <ArticleOutlinedIcon fontSize='small' /> : <SpeakerNotesOffOutlinedIcon fontSize='small' />}
        </IconButton>
      </span>
    </Tooltip>
  );
};

const DeviceServiceTable: React.FC<{
  services: PresentedDeviceService[];
  isPending: boolean;
  showControls: boolean;
  showLogSelection: boolean;
  isExecutingCommand: boolean;
  invokeSupervisor: (imageInstall: ServiceRecord, command: 'start' | 'stop' | 'restart') => Promise<void>;
}> = ({ services, isPending, showControls, showLogSelection, isExecutingCommand, invokeSupervisor }) => {
  const theme = useTheme();
  const list = useList({
    data: services.map((service, presentationOrder) => ({ ...service, presentationOrder })),
    isPending,
    perPage: 1000,
    sort: { field: 'presentationOrder', order: 'ASC' },
  });

  return (
    <ListContextProvider value={list}>
      <Datagrid bulkActionButtons={false}>
        <WithRecord
          render={(service) => {
            const color =
              service.status === 'Running'
                ? theme.palette.success.light
                : service.status === 'Error'
                  ? theme.palette.error.light
                  : theme.palette.warning.light;

            return <TripOriginIcon aria-label={`${service.status ?? 'Unknown'} status`} sx={{ color }} />;
          }}
        />

        <FunctionField
          label='Service'
          sortable={false}
          render={(service: PresentedDeviceService) =>
            service.serviceId !== undefined ? (
              <Box component={Link} to={`/service/${service.serviceId}`} sx={{ textDecoration: 'none' }}>
                <ServiceBadge name={service.serviceName} />
              </Box>
            ) : (
              <ServiceBadge name={service.serviceName} />
            )
          }
        />

        <TextField label='Status' source='status' sortable={false} />

        <ReferenceField label='Release' source='is provided by-release' reference='release' sortable={false}>
          <SemVerChip />
        </ReferenceField>

        {showControls ? (
          <FunctionField
            label='Controls'
            render={(serviceRecord: ServiceRecord) => {
              const isRunning = serviceRecord.status?.toLowerCase() === 'running';

              return (
                <Toolbar
                  style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}
                >
                  <Button
                    aria-label='Start service'
                    onClick={(event) => {
                      event.stopPropagation();
                      void invokeSupervisor(serviceRecord, 'start');
                    }}
                    disabled={isRunning || isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <PlayArrowIcon />
                  </Button>

                  <Button
                    aria-label='Stop service'
                    onClick={(event) => {
                      event.stopPropagation();
                      void invokeSupervisor(serviceRecord, 'stop');
                    }}
                    disabled={!isRunning || isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <StopIcon />
                  </Button>

                  <Button
                    aria-label='Restart service'
                    onClick={(event) => {
                      event.stopPropagation();
                      void invokeSupervisor(serviceRecord, 'restart');
                    }}
                    disabled={isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <RestartAltIcon />
                  </Button>
                </Toolbar>
              );
            }}
          />
        ) : null}

        {showLogSelection ? (
          <FunctionField
            label='Logs'
            render={(serviceRecord: PresentedDeviceService) => <ServiceLogsButton imageInstall={serviceRecord} />}
          />
        ) : null}
      </Datagrid>
    </ListContextProvider>
  );
};

export const DeviceServices: React.FC<DeviceServicesProps> = ({ device, showLogSelection = false }) => {
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const notify = useNotify();
  const record = useRecordContext<ResourceRecord>();
  const presentation = useDeviceServicePresentation(device);
  const refreshActions = useDeviceRefreshActions();
  const queryClient = useQueryClient();

  const [isExecutingCommand, setIsExecutingCommand] = React.useState(false);

  const invokeSupervisor = React.useCallback(
    async (imageInstall: ServiceRecord, command: 'start' | 'stop' | 'restart') => {
      const session: OpenBalenaSession | undefined = authProvider?.getSession?.();
      if (!session?.jwt) {
        notify('Error: Unable to execute command without a valid session', { type: 'error' });
        return;
      }

      const imageId = relationshipId(imageInstall['installs-image']);
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
      const actionId = refreshActions.begin({
        deviceId: device.id,
        kind: command,
        imageInstallId: imageInstall.id,
        imageId,
      });

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
          throw new HttpError(response.statusText, response.status);
        }

        const result = (await response.text()).trim();
        if (response.status !== 204 && result !== 'OK')
          throw new Error('The Supervisor returned an unexpected command response.');
        refreshActions.acknowledge(actionId);
        refreshDeviceStateQueries(queryClient, device.id);
        notify(`Successfully executed command ${command} on device ${deviceName}`, { type: 'success' });
      } catch (error) {
        refreshActions.cancel(actionId);
        notify(
          withPermissionHint(
            `Error: Could not execute command ${command} on device ${deviceName}${error instanceof Error ? `: ${error.message}` : ''}`,
            error instanceof HttpError ? error.status : undefined,
          ),
          { type: 'error' },
        );
      } finally {
        setIsExecutingCommand(false);
      }
    },
    [
      authProvider,
      device,
      notify,
      refreshActions.begin,
      refreshActions.acknowledge,
      refreshActions.cancel,
      queryClient,
    ],
  );

  if (!record) {
    return null;
  }

  return (
    <>
      {presentation.error ? (
        <Alert severity='error'>Unable to load device services: {presentation.error.message}</Alert>
      ) : null}
      <Typography variant='h6' component='h2' sx={{ mb: 1 }}>
        App
      </Typography>
      {relationshipId(record['is running-release']) !== undefined ? (
        <DeviceServiceTable
          services={presentation.appServices}
          isPending={presentation.isPending}
          showControls
          showLogSelection={showLogSelection}
          isExecutingCommand={isExecutingCommand}
          invokeSupervisor={invokeSupervisor}
        />
      ) : (
        <Typography color='text.secondary'>No running application release.</Typography>
      )}

      {presentation.showSupervisorServices ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant='h6' component='h2' sx={{ mb: 1 }}>
            Supervisor
          </Typography>
          <DeviceServiceTable
            services={presentation.supervisorServices}
            isPending={presentation.isPending}
            showControls={false}
            showLogSelection={showLogSelection}
            isExecutingCommand={isExecutingCommand}
            invokeSupervisor={invokeSupervisor}
          />
        </Box>
      ) : null}
    </>
  );
};

export default DeviceServices;
