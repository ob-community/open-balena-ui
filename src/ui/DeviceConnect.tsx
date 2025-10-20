import { Box } from '@mui/material';
import React from 'react';
import { Form, SelectInput, useAuthProvider, useDataProvider, useRecordContext } from 'react-admin';
import environment from '../lib/reactAppEnv';
var sshpk = require('sshpk-browser');

export class Iframe extends React.Component {
  render() {
    return (
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
        <iframe
          id={this.props.id}
          title={this.props.title}
          src={this.props.src}
          height={this.props.height}
          width={this.props.width}
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
  }
}

export const DeviceConnect = (props) => {
  // record is passed via props when accessed from dashboards
  const record = useRecordContext() || props.record;
  const [loaded, setLoaded] = React.useState(false);
  const [userId, setUserId] = React.useState();
  const [containers, setContainers] = React.useState({ choices: [], services: [], links: [] });
  const [iframeUrl, setIframeUrl] = React.useState('');
  const dataProvider = useDataProvider();
  const authProvider = useAuthProvider();

  const genRsaKeys = () => {
    return window.crypto.subtle
      .generateKey(
        { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: { name: 'SHA-256' } },
        true,
        ['encrypt', 'decrypt'],
      )
      .then((keyPair) => {
        return window.crypto.subtle.exportKey('spki', keyPair.publicKey).then((publicKeyEncoded) => {
          const publicKey = window.btoa(String.fromCharCode.apply(null, new Uint8Array(publicKeyEncoded)));
          return window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey).then((privateKeyEncoded) => {
            const privateKey = window.btoa(String.fromCharCode.apply(null, new Uint8Array(privateKeyEncoded)));
            const publicKeySsh = sshpk
              .parseKey(`-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`, 'pem')
              .toString('ssh');
            const privateKeySsh = sshpk
              .parsePrivateKey(`-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`, 'pem')
              .toString('ssh');
            return { publicKeySsh: publicKeySsh, privateKeySsh: privateKeySsh };
          });
        });
      });
  };

  const upsertUserPublicKey = (publicKeySsh) => {
    const keyTitle = 'open-balena-remote';
      return dataProvider
        .getList('user-has-public key', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { user: userId, title: keyTitle },
        })
        .then((remoteKey) => {
          if (remoteKey.data.length > 0) {
            return dataProvider.update('user-has-public key', {
              id: remoteKey.data[0].id,
              data: { 'user': userId, 'title': keyTitle, 'public key': publicKeySsh },
            });
          } else {
            return dataProvider.create('user-has-public key', {
              data: { 'user': userId, 'title': keyTitle, 'public key': publicKeySsh },
            });
          }
        });
  };

  const handleSubmit = (url) => {
    if (url !== '' && url !== 'default') {
      genRsaKeys().then((rsaKeys) => {
        upsertUserPublicKey(rsaKeys.publicKeySsh).then(() => {
          dataProvider.getOne('user', { id: userId }).then((user) => {
            console.log('user', user);
            url += `&username=${user.data.username}&privateKey=${encodeURIComponent(rsaKeys.privateKeySsh)}`;
            setIframeUrl(url);
          });
        });
      });
    }
  };

  React.useEffect(() => {
    if (!loaded) {
      let REMOTE_HOST = environment.REACT_APP_OPEN_BALENA_REMOTE_URL;

      let session = authProvider.getSession();

      setUserId(session.object.id);

      let containerChoices = [{ id: 0, name: 'host' }];
      let containerServices = [[{ id: 0, name: 'SSH' }]];
      let containerLinks = [[`${REMOTE_HOST}?service=ssh&uuid=${record.uuid}&jwt=${session.jwt}`]];

      dataProvider
        .getList('image install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { device: record.id, status: 'Running' },
        })
        .then((installs) => {
          Promise.all(
            installs.data.map(async (install) => {
              let image = await dataProvider
                .getList('image', {
                  pagination: { page: 1, perPage: 1000 },
                  sort: { field: 'id', order: 'ASC' },
                  filter: { id: install['installs-image'] },
                })
                .then(async (imageRec) => {
                  return await dataProvider
                    .getList('service', {
                      pagination: { page: 1, perPage: 1000 },
                      sort: { field: 'id', order: 'ASC' },
                      filter: { id: imageRec.data[0]['is a build of-service'] },
                    })
                    .then(async (imageService) => {
                      return await dataProvider
                        .getList('image-is part of-release', {
                          pagination: { page: 1, perPage: 1000 },
                          sort: { field: 'id', order: 'ASC' },
                          filter: { image: install['installs-image'] },
                        })
                        .then(async (imageRelease) => {
                          return await dataProvider
                            .getList('image label', {
                              pagination: { page: 1, perPage: 1000 },
                              sort: { field: 'id', order: 'ASC' },
                              filter: { 'release image': imageRelease.data[0]['id'] },
                            })
                            .then((imageLabels) => {
                              return {
                                labels: imageLabels,
                                service: imageService,
                                install: install,
                                image: imageRec,
                              };
                            });
                        });
                    });
                });
              let containerName = image.service.data[0]['service name'];
              let services = [{ id: 0, name: 'SSH' }];
              let links = [
                `${REMOTE_HOST}?service=ssh&container=${containerName}&uuid=${record.uuid}&jwt=${session.jwt}`,
              ];
              if (image.labels.data.find((x) => x['label name'] === 'openbalena.remote.http')) {
                let name = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.http.label');
                services.push({ id: services.length, name: name ? name.value : 'HTTP' });
                let port = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.http.port');
                let path = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.http.path');
                links.push(
                  `${REMOTE_HOST}${path ? path.value : ''}?service=tunnel&port=${port ? port.value : '80'}&protocol=http&uuid=${record.uuid}&jwt=${session.jwt}`,
                );
              }
              if (image.labels.data.find((x) => x['label name'] === 'openbalena.remote.https')) {
                let name = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.https.label');
                services.push({ id: services.length, name: name ? name.value : 'HTTPS' });
                let port = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.https.port');
                let path = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.https.path');
                links.push(
                  `${REMOTE_HOST}${path ? path.value : ''}?service=tunnel&port=${port ? port.value : '443'}&protocol=https&uuid=${record.uuid}&jwt=${session.jwt}`,
                );
              }
              if (image.labels.data.find((x) => x['label name'] === 'openbalena.remote.vnc')) {
                let name = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.vnc.label');
                services.push({ id: services.length, name: name ? name.value : 'VNC' });
                let port = image.labels.data.find((x) => x['label name'] === 'openbalena.remote.vnc.port');
                links.push(
                  `${REMOTE_HOST}?service=vnc&port=${port ? port.value : '5900'}&uuid=${record.uuid}&jwt=${session.jwt}`,
                );
              }
              containerChoices.push({ id: containerChoices.length, name: containerName });
              containerServices.push(services);
              containerLinks.push(links);
              return Promise.resolve();
            }),
          ).then(() => {
            setContainers({ choices: containerChoices, services: containerServices, links: containerLinks });
          });
        });
      setLoaded(true);
    }
  }, [record, authProvider, dataProvider, setLoaded, loaded]);

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
            choices={containers.choices
              .map((container, containerIdx) => {
                // get services for container, which are an array, and flatten them
                let services = containers.services[containerIdx];
                return services.map((service, serviceIdx) => {
                  return {
                    label: `${container.name} - ${service.name}`,
                    value: containers.links[containerIdx][serviceIdx],
                  };
                });
              })
              .flat()}
            defaultValue='default'
            emptyText='Select Service'
            emptyValue='default'
            optionText='label'
            optionValue='value'
            onChange={(event) => handleSubmit(event.target.value)}
          />
        </Box>
      </Form>

      <Iframe src={iframeUrl} width='100%' height='100%' />
    </>
  );
};

export default DeviceConnect;
