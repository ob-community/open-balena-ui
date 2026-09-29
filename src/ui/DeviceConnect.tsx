import { Alert, Box, useTheme } from '@mui/material';
import React from 'react';
import { Form, SelectInput, useAuthProvider, useDataProvider, useNotify, useRecordContext } from 'react-admin';
import type { DataProvider, Identifier } from 'react-admin';
import environment from '../lib/reactAppEnv';
import ssh from 'micro-key-producer/ssh.js';
import { randomBytes } from 'micro-key-producer/utils.js';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';
import {
  addDeviceConnectionCredentials,
  buildDeviceConnectionUrl,
  parseRemoteBaseUrl,
  type DeviceConnectionTarget,
} from '../lib/deviceConnect';
import type { ResourceRecord } from '../types/resource';
import { EmbeddedFrame } from './EmbeddedFrame';
import BuiltInDeviceConnect from './BuiltInDeviceConnect';

interface DeviceConnectProps {
  record?: ResourceRecord;
}

const LegacyDeviceConnect: React.FC<DeviceConnectProps> = ({ record: recordProp }) => {
  const contextRecord = useRecordContext<ResourceRecord>();
  const record = contextRecord ?? recordProp;
  const [loaded, setLoaded] = React.useState(false);
  const [userId, setUserId] = React.useState<Identifier>();
  const [remoteOrigin, setRemoteOrigin] = React.useState('');
  const [targets, setTargets] = React.useState<DeviceConnectionTarget[]>([]);
  const [iframeUrl, setIframeUrl] = React.useState('');
  const dataProvider = useDataProvider<DataProvider>();
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const notify = useNotify();
  const theme = useTheme();

  // Get logs background color from theme palette
  const logsPalette = theme.palette.logs;
  const logsBgColor = logsPalette?.background ?? (theme.palette.mode === 'dark' ? '#0d1a26' : '#343434');

  const generateSshKeys = async (): Promise<{ publicKeySsh: string; privateKeySsh: string }> => {
    const seed = randomBytes(32);
    const { publicKey, privateKey } = ssh(seed, 'open-balena-remote');
    return { publicKeySsh: publicKey, privateKeySsh: privateKey };
  };

  const upsertUserPublicKey = async (publicKeySsh: string): Promise<void> => {
    if (!userId) {
      throw new Error('User identifier not available');
    }

    const keyTitle = 'open-balena-remote';
    const remoteKey = await dataProvider.getList<ResourceRecord>('user-has-public key', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { user: userId, title: keyTitle },
    });

    if (remoteKey.data.length > 0) {
      const existing = remoteKey.data[0];
      await dataProvider.update('user-has-public key', {
        id: existing.id,
        data: { 'user': userId, 'title': keyTitle, 'public key': publicKeySsh },
        previousData: existing,
      });
    } else {
      await dataProvider.create('user-has-public key', {
        data: { 'user': userId, 'title': keyTitle, 'public key': publicKeySsh },
      });
    }
  };

  const handleSubmit = (input: unknown): void => {
    const targetId = typeof input === 'string' ? input : '';
    const target = targets.find(({ id }) => id === targetId);
    if (!target || !remoteOrigin) {
      return;
    }

    void (async () => {
      const sshKeys = await generateSshKeys();
      await upsertUserPublicKey(sshKeys.publicKeySsh);
      if (!userId) {
        return;
      }
      const user = await dataProvider.getOne<ResourceRecord>('user', { id: userId });
      const username = typeof user.data.username === 'string' ? user.data.username : '';
      const nextUrl = addDeviceConnectionCredentials(targets, target.id, remoteOrigin, username, sshKeys.privateKeySsh);
      if (!nextUrl) {
        notify('Error: Invalid device connection target', { type: 'error' });
        return;
      }
      setIframeUrl(nextUrl);
    })().catch((error: unknown) => {
      console.error(error);
      notify(error instanceof Error ? error.message : 'Unable to connect to the device', { type: 'error' });
    });
  };

  React.useEffect(() => {
    if (loaded || !record || !authProvider) {
      return;
    }

    const session: OpenBalenaSession = authProvider.getSession();
    const sessionJwt = session.jwt ?? '';
    const sessionObject = session.object ?? {};
    const identifier = sessionObject.id as Identifier | undefined;
    const deviceUuid = record.uuid;

    if (!identifier || !sessionJwt || typeof deviceUuid !== 'string') {
      return;
    }

    setUserId(identifier);

    const remoteBaseUrl = parseRemoteBaseUrl(environment.REACT_APP_OPEN_BALENA_REMOTE_URL);
    if (!remoteBaseUrl) {
      setLoaded(true);
      notify('Device connections are unavailable because the remote access URL is not configured safely.', {
        type: 'error',
      });
      return;
    }
    setRemoteOrigin(remoteBaseUrl.origin);

    void (async () => {
      try {
        const hostUrl = buildDeviceConnectionUrl(remoteBaseUrl, undefined, {
          service: 'ssh',
          uuid: deviceUuid,
          jwt: sessionJwt,
        });
        const hostTargets: DeviceConnectionTarget[] = hostUrl
          ? [{ id: 'host:ssh', label: 'host - SSH', url: hostUrl }]
          : [];
        const installs = await dataProvider.getList<ResourceRecord>('image install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { device: record.id, status: 'Running' },
        });

        const applicationTargets = await Promise.all(
          installs.data.map(async (install): Promise<DeviceConnectionTarget[]> => {
            const imageRec = await dataProvider.getList<ResourceRecord>('image', {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: 'id', order: 'ASC' },
              filter: { id: install['installs-image'] },
            });

            const imageService = await dataProvider.getList<ResourceRecord>('service', {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: 'id', order: 'ASC' },
              filter: { id: imageRec.data[0]?.['is a build of-service'] },
            });

            const imageRelease = await dataProvider.getList<ResourceRecord>('image-is part of-release', {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: 'id', order: 'ASC' },
              filter: { image: install['installs-image'] },
            });

            const imageLabels = await dataProvider.getList<ResourceRecord>('image label', {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: 'id', order: 'ASC' },
              filter: { 'release image': imageRelease.data[0]?.id },
            });

            const containerName = imageService.data[0]?.['service name'];
            if (typeof containerName !== 'string') {
              return [];
            }

            const targetPrefix = `install:${String(install.id)}`;
            const commonParameters = {
              container: containerName,
              uuid: deviceUuid,
              jwt: sessionJwt,
            };
            const connectionTargets: DeviceConnectionTarget[] = [];
            const addTarget = (id: string, label: string, path: unknown, parameters: Record<string, string>): void => {
              const url = buildDeviceConnectionUrl(remoteBaseUrl, path, parameters);
              if (url) {
                connectionTargets.push({ id: `${targetPrefix}:${id}`, label: `${containerName} - ${label}`, url });
              }
            };

            addTarget('ssh', 'SSH', undefined, { ...commonParameters, service: 'ssh' });

            const httpLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http');
            if (httpLabel) {
              const nameLabel = imageLabels.data.find(
                (label) => label['label name'] === 'openbalena.remote.http.label',
              );
              const portLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http.port');
              const pathLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http.path');

              addTarget('http', typeof nameLabel?.value === 'string' ? nameLabel.value : 'HTTP', pathLabel?.value, {
                ...commonParameters,
                service: 'tunnel',
                port: typeof portLabel?.value === 'string' ? portLabel.value : '80',
                protocol: 'http',
              });
            }

            const httpsLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.https');
            if (httpsLabel) {
              const nameLabel = imageLabels.data.find(
                (label) => label['label name'] === 'openbalena.remote.https.label',
              );
              const portLabel = imageLabels.data.find(
                (label) => label['label name'] === 'openbalena.remote.https.port',
              );
              const pathLabel = imageLabels.data.find(
                (label) => label['label name'] === 'openbalena.remote.https.path',
              );

              addTarget('https', typeof nameLabel?.value === 'string' ? nameLabel.value : 'HTTPS', pathLabel?.value, {
                ...commonParameters,
                service: 'tunnel',
                port: typeof portLabel?.value === 'string' ? portLabel.value : '443',
                protocol: 'https',
              });
            }

            const vncLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.vnc');
            if (vncLabel) {
              const nameLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.vnc.label');
              const portLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.vnc.port');

              addTarget('vnc', typeof nameLabel?.value === 'string' ? nameLabel.value : 'VNC', undefined, {
                ...commonParameters,
                service: 'vnc',
                port: typeof portLabel?.value === 'string' ? portLabel.value : '5900',
              });
            }

            return connectionTargets;
          }),
        );

        setTargets([...hostTargets, ...applicationTargets.flat()]);
      } catch (error) {
        console.error(error);
        notify(error instanceof Error ? error.message : 'Unable to load device connection targets', { type: 'error' });
      } finally {
        setLoaded(true);
      }
    })();
  }, [authProvider, dataProvider, loaded, notify, record]);

  if (!record) {
    return null;
  }

  return (
    <>
      <Form onSubmit={handleSubmit}>
        <Box
          sx={{
            'display': 'flex',
            'padding': '5px 15px',
            'paddingRight': '70px',
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
          <strong style={{ flex: 1 }}>Connect</strong>

          <SelectInput
            source='container'
            disabled={targets.length === 0}
            choices={targets}
            defaultValue='default'
            emptyText='Select Service'
            emptyValue='default'
            optionText='label'
            optionValue='id'
            onChange={(event) => handleSubmit((event.target as HTMLInputElement).value)}
          />
        </Box>
      </Form>

      <EmbeddedFrame src={iframeUrl} backgroundColor={logsBgColor} />
    </>
  );
};

export const DeviceConnect: React.FC<DeviceConnectProps> = ({ record: recordProp }) => {
  const contextRecord = useRecordContext<ResourceRecord>();
  const record = contextRecord ?? recordProp;

  if (!environment.REACT_APP_OPEN_BALENA_REMOTE_URL) {
    if (!environment.REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED) {
      return <Alert severity='info'>Built-in remote access is not configured on this open-balena-ui server.</Alert>;
    }
    return record ? <BuiltInDeviceConnect record={record} /> : null;
  }

  return <LegacyDeviceConnect record={record} />;
};

export default DeviceConnect;
