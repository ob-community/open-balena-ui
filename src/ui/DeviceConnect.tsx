import { Box } from '@mui/material';
import React from 'react';
import { Form, SelectInput, useAuthProvider, useDataProvider, useRecordContext } from 'react-admin';
import type { DataProvider, Identifier } from 'react-admin';
import environment from '../lib/reactAppEnv';
import ssh from 'micro-key-producer/ssh.js';
import { randomBytes } from 'micro-key-producer/utils.js';
import type { OpenBalenaAuthProvider, OpenBalenaSession } from '../authProvider/openbalenaAuthProvider';
import type { ResourceRecord } from '../types/resource';

interface IframeProps {
  id?: string;
  title?: string;
  src: string;
  height?: string | number;
  width?: string | number;
}

interface ContainerOption {
  id: number;
  name: string;
}

interface ServiceOption {
  id: number;
  name: string;
}

interface ContainerState {
  choices: ContainerOption[];
  services: ServiceOption[][];
  links: string[][];
}

interface DeviceConnectProps {
  record?: ResourceRecord;
}

const createSelectChoices = (containers: ContainerState): Array<{ label: string; value: string }> =>
  containers.choices
    .map((container, containerIdx) => {
      const services = containers.services[containerIdx];
      const links = containers.links[containerIdx];

      return services.map((service, serviceIdx) => ({
        label: `${container.name} - ${service.name}`,
        value: links[serviceIdx] ?? 'default',
      }));
    })
    .flat();

export const Iframe: React.FC<IframeProps> = ({ id, title, src, height, width }) => (
  <div style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
    <iframe
      id={id}
      title={title}
      src={src}
      height={height}
      width={width}
      frameBorder={0}
      style={{
        flex: '1',
        position: 'relative',
        minHeight: '400px',
        background: 'rgb(52, 52, 52)',
      }}
    />
  </div>
);

export const DeviceConnect: React.FC<DeviceConnectProps> = ({ record: recordProp }) => {
  const contextRecord = useRecordContext<ResourceRecord>();
  const record = contextRecord ?? recordProp;
  const [loaded, setLoaded] = React.useState(false);
  const [userId, setUserId] = React.useState<Identifier>();
  const [containers, setContainers] = React.useState<ContainerState>({ choices: [], services: [], links: [] });
  const [iframeUrl, setIframeUrl] = React.useState('');
  const dataProvider = useDataProvider<DataProvider>();
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();

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
    const url = typeof input === 'string' ? input : '';

    if (!url || url === 'default') {
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
      const nextUrl = `${url}&username=${username}&privateKey=${encodeURIComponent(sshKeys.privateKeySsh)}`;
      setIframeUrl(nextUrl);
    })();
  };

  React.useEffect(() => {
    if (loaded || !record || !authProvider) {
      return;
    }

    const session: OpenBalenaSession = authProvider.getSession();
    const sessionJwt = session.jwt ?? '';
    const sessionObject = session.object ?? {};
    const identifier = sessionObject.id as Identifier | undefined;

    if (!identifier || typeof record.uuid !== 'string') {
      return;
    }

    setUserId(identifier);

    const remoteHost = environment.REACT_APP_OPEN_BALENA_REMOTE_URL ?? '';

    const containerChoices: ContainerOption[] = [{ id: 0, name: 'host' }];
    const containerServices: ServiceOption[][] = [[{ id: 0, name: 'SSH' }]];
    const containerLinks: string[][] = [[`${remoteHost}?service=ssh&uuid=${record.uuid}&jwt=${sessionJwt}`]];

    void (async () => {
      const installs = await dataProvider.getList<ResourceRecord>('image install', {
        pagination: { page: 1, perPage: 1000 },
        sort: { field: 'id', order: 'ASC' },
        filter: { device: record.id, status: 'Running' },
      });

      await Promise.all(
        installs.data.map(async (install) => {
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
            return;
          }

          const services: ServiceOption[] = [{ id: 0, name: 'SSH' }];
          const links: string[] = [
            `${remoteHost}?service=ssh&container=${containerName}&uuid=${record.uuid}&jwt=${sessionJwt}`,
          ];

          const httpLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http');
          if (httpLabel) {
            const nameLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http.label');
            const portLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http.port');
            const pathLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.http.path');

            services.push({ id: services.length, name: (nameLabel?.value as string) ?? 'HTTP' });
            links.push(
              `${remoteHost}${(pathLabel?.value as string) ?? ''}?service=tunnel&port=${(portLabel?.value as string) ?? '80'}&protocol=http&uuid=${record.uuid}&jwt=${sessionJwt}`,
            );
          }

          const httpsLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.https');
          if (httpsLabel) {
            const nameLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.https.label');
            const portLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.https.port');
            const pathLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.https.path');

            services.push({ id: services.length, name: (nameLabel?.value as string) ?? 'HTTPS' });
            links.push(
              `${remoteHost}${(pathLabel?.value as string) ?? ''}?service=tunnel&port=${(portLabel?.value as string) ?? '443'}&protocol=https&uuid=${record.uuid}&jwt=${sessionJwt}`,
            );
          }

          const vncLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.vnc');
          if (vncLabel) {
            const nameLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.vnc.label');
            const portLabel = imageLabels.data.find((label) => label['label name'] === 'openbalena.remote.vnc.port');

            services.push({ id: services.length, name: (nameLabel?.value as string) ?? 'VNC' });
            links.push(
              `${remoteHost}?service=vnc&port=${(portLabel?.value as string) ?? '5900'}&uuid=${record.uuid}&jwt=${sessionJwt}`,
            );
          }

          containerChoices.push({ id: containerChoices.length, name: containerName });
          containerServices.push(services);
          containerLinks.push(links);
        }),
      );

      setContainers({ choices: containerChoices, services: containerServices, links: containerLinks });
      setLoaded(true);
    })();
  }, [authProvider, dataProvider, loaded, record]);

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
            disabled={containers.choices.length === 0}
            choices={createSelectChoices(containers)}
            defaultValue='default'
            emptyText='Select Service'
            emptyValue='default'
            optionText='label'
            optionValue='value'
            onChange={(event) => handleSubmit((event.target as HTMLInputElement).value)}
          />
        </Box>
      </Form>

      <Iframe src={iframeUrl} width='100%' height='100%' />
    </>
  );
};

export default DeviceConnect;
