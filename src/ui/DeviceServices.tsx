import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopIcon from '@mui/icons-material/Stop';
import TripOriginIcon from '@mui/icons-material/TripOrigin';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import { Box, Button, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import React from 'react';
import {
  Datagrid,
  FunctionField,
  HttpError,
  ReferenceField,
  ReferenceManyField,
  TextField,
  Toolbar,
  WithRecord,
  useAuthProvider,
  useGetOne,
  useNotify,
  useRecordContext,
} from 'react-admin';
import utf8decode from '../lib/utf8decode';
import { withPermissionHint } from '../lib/httpErrorMessage';
import SemVerChip from './SemVerChip';
import environment from '../lib/reactAppEnv';
import type { ResourceRecord } from '../types/resource';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';
import { hasSupervisorServiceTable, relationshipId, selectDeviceLogService } from '../lib/deviceServicePresentation';

interface DeviceServicesProps {
  device: ResourceRecord;
  showLogSelection?: boolean;
}

type ServiceRecord = ResourceRecord & {
  status?: string;
  ['installs-image']?: number | string;
};

const ServiceLogsButton: React.FC<{ imageInstall: ServiceRecord }> = ({ imageInstall }) => {
  const imageId = imageInstall['installs-image'];
  const { data: image } = useGetOne<ResourceRecord>(
    'image',
    { id: imageId ?? 0 },
    { enabled: imageId !== undefined && imageId !== null },
  );
  const serviceId = relationshipId(image?.['is a build of-service']);
  const { data: service } = useGetOne<ResourceRecord>(
    'service',
    { id: serviceId ?? 0 },
    { enabled: serviceId !== undefined },
  );
  const numericServiceId = typeof serviceId === 'number' ? serviceId : Number(serviceId);
  const serviceName = String(service?.['service name'] ?? 'service');
  const canSelect = Number.isFinite(numericServiceId);

  return (
    <Tooltip title={`Show only ${serviceName} logs`}>
      <span>
        <IconButton
          aria-label={`Show only ${serviceName} logs`}
          disabled={!canSelect}
          size='small'
          onClick={() => selectDeviceLogService({ serviceId: numericServiceId, serviceName })}
        >
          <ArticleOutlinedIcon fontSize='small' />
        </IconButton>
      </span>
    </Tooltip>
  );
};

const DeviceServiceTable: React.FC<{
  releaseId?: number | string;
  showControls: boolean;
  showLogSelection: boolean;
  isExecutingCommand: boolean;
  invokeSupervisor: (imageInstall: ServiceRecord, command: 'start' | 'stop' | 'restart') => Promise<void>;
}> = ({ releaseId, showControls, showLogSelection, isExecutingCommand, invokeSupervisor }) => {
  const theme = useTheme();

  return (
    <ReferenceManyField
      source='id'
      reference='image install'
      target='device'
      filter={releaseId !== undefined ? { 'is provided by-release': releaseId } : {}}
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

            return <TripOriginIcon aria-label={`${service.status ?? 'Unknown'} status`} sx={{ color }} />;
          }}
        />

        <ReferenceField label='Service' source='installs-image' reference='image' link={false}>
          <ReferenceField
            source='is a build of-service'
            reference='service'
            link={(record, reference) => `/${reference}/${record['is a build of-service']}`}
          >
            <TextField source='service name' />
          </ReferenceField>
        </ReferenceField>

        <TextField label='Status' source='status' />

        <ReferenceField label='Release' source='is provided by-release' reference='release'>
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
                    onClick={() => invokeSupervisor(serviceRecord, 'start')}
                    disabled={isRunning || isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <PlayArrowIcon />
                  </Button>

                  <Button
                    aria-label='Stop service'
                    onClick={() => invokeSupervisor(serviceRecord, 'stop')}
                    disabled={!isRunning || isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <StopIcon />
                  </Button>

                  <Button
                    aria-label='Restart service'
                    onClick={() => invokeSupervisor(serviceRecord, 'restart')}
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
            render={(serviceRecord: ServiceRecord) => <ServiceLogsButton imageInstall={serviceRecord} />}
          />
        ) : null}
      </Datagrid>
    </ReferenceManyField>
  );
};

export const DeviceServices: React.FC<DeviceServicesProps> = ({ device, showLogSelection = false }) => {
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const notify = useNotify();
  const record = useRecordContext<ResourceRecord>();

  const [isExecutingCommand, setIsExecutingCommand] = React.useState(false);
  const supervisorReleaseId = relationshipId(device['should be managed by-release']);
  const { data: supervisorRelease } = useGetOne<ResourceRecord>(
    'release',
    { id: supervisorReleaseId ?? 0 },
    { enabled: supervisorReleaseId !== undefined },
  );
  const supervisorReleaseVersion = supervisorRelease?.['raw version'] ?? supervisorRelease?.raw_version;
  const showSupervisorServices =
    supervisorReleaseId !== undefined && hasSupervisorServiceTable(supervisorReleaseVersion);

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
          throw new HttpError(response.statusText, response.status);
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
        notify(
          withPermissionHint(
            `Error: Could not execute command ${command} on device ${deviceName}`,
            error instanceof HttpError ? error.status : undefined,
          ),
          { type: 'error' },
        );
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
    <>
      <Typography variant='h6' component='h2' sx={{ mb: 1 }}>
        App
      </Typography>
      {relationshipId(record['is running-release']) !== undefined ? (
        <DeviceServiceTable
          releaseId={relationshipId(record['is running-release'])}
          showControls
          showLogSelection={showLogSelection}
          isExecutingCommand={isExecutingCommand}
          invokeSupervisor={invokeSupervisor}
        />
      ) : (
        <Typography color='text.secondary'>No running application release.</Typography>
      )}

      {showSupervisorServices ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant='h6' component='h2' sx={{ mb: 1 }}>
            Supervisor
          </Typography>
          <DeviceServiceTable
            releaseId={supervisorReleaseId}
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
