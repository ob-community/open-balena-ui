import { Box } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import React from 'react';
import { Form, SelectInput, useAuthProvider, useDataProvider, useRecordContext, useNotify } from 'react-admin';
import environment from '../lib/reactAppEnv';

export class Iframe extends React.Component {
  render() {
    return (
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
        <iframe
          id={this.props.id}
          title={this.props.title}
          srcDoc={this.props.content}
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

export const DeviceLogs = () => {
  const record = useRecordContext();
  const [loaded, setLoaded] = React.useState(false);
  const [containers, setContainers] = React.useState([]);
  const [container, setContainer] = React.useState('default');
  const [content, setContent] = React.useState('');
  const dataProvider = useDataProvider();
  const authProvider = useAuthProvider();
  const notify = useNotify();
  const session = authProvider.getSession();

  const fetchLogs = () => {
    let API_HOST = environment.REACT_APP_OPEN_BALENA_API_URL;

    return fetch(`${API_HOST}/device/v2/${record.uuid}/logs`, {
      method: 'GET',
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
        return response.json();
      })
      .catch((e) => {
        console.error(e.message);
      });
  };

  const updateLogs = () => {
    fetchLogs()
      .then((logs) => {
        if (logs && logs.length > 0) {
          const containerLogs = logs.filter((x) =>
            container === 0 ? !x.hasOwnProperty('serviceId') : x.serviceId === container,
          );

          const formattedLogs = containerLogs
            .map((x) => {
              const time = new Date(x.timestamp).toISOString();
              const msg = x.isStdErr
                ? `<span style="color: #ee6666; ">${x.message}</span>`
                : x.isSystem
                  ? `<span style="color: #ffee66; ">${x.message}</span>`
                  : x.message;
              return `[${time}] ${msg}`;
            })
            .join('<br/>');

          setContent(
            `<html>
            <body style='font-family: consolas; color: #eeeeee'>
              <div>${formattedLogs}</div>
              <script>window.scrollTo(0, document.body.scrollHeight);</script>
            </body>
          </html>`,
          );
        }
      })
      .catch((e) => {
        console.error(e.message);
        notify(`Error: Could not get logs for device ${record.uuid}`, { type: 'error' });
      });
  };

  React.useEffect(() => {
    if (container !== 'default') {
      updateLogs();
    }
  }, [container]);

  React.useEffect(() => {
    if (!loaded) {
      let containerChoices = [{ id: 0, name: 'host' }];
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
                      return {
                        service: imageService,
                      };
                    });
                });
              let containerName = image.service.data[0]['service name'];
              containerChoices.push({ id: image.service.data[0].id, name: containerName });
              return Promise.resolve();
            }),
          ).then(() => {
            setContainers(containerChoices);
          });
        });
      setLoaded(true);
    }
  }, [record, authProvider, dataProvider, setContainers, setLoaded, loaded]);

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
            onChange={(event) => setContainer(event.target.value)}
          />

          <IconButton
            disabled={container === 'default'}
            size='small'
            sx={{ml: '10px'}}
            onClick={updateLogs}
          >
            <RefreshIcon />
          </IconButton>
        </Box>
      </Form>

      <Iframe content={content} width='100%' height='100%' />
    </>
  );
};

export default DeviceLogs;
