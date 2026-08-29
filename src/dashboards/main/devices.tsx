import React from 'react';
import {
  FunctionField,
  Link,
  List,
  ReferenceField,
  ResourceContextProvider,
  SearchInput,
  ShowButton,
  WithListContext,
} from 'react-admin';
import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import { EditButton } from 'react-admin';
import EnvVarButton from '../../ui/EnvVarButton';
import DeviceConnectButton from '../../ui/DeviceConnectButton';
import { LastOnlineField, OnlineField } from '../../components/device';
import CopyChip from '../../ui/CopyChip';
import { getSemver } from '../../ui/SemVerChip';
import versions from '../../versions';
import environment from '../../lib/reactAppEnv';
import { compareDeviceConnectivity } from '../../lib/deviceStatus';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
const deviceStatusRefreshInterval = 30000;

const deviceCardFilters = [<SearchInput source='#uuid,device name,status@ilike' alwaysOn />];

function sortDevicesByConnectivity<T extends Record<string, any>>(devices: T[]): T[] {
  return [...devices].sort((first, second) => compareDeviceConnectivity(first, second));
}

export const DeviceCards: React.FC = () => (
  <ResourceContextProvider value='device'>
    <List
      emptyWhileLoading
      disableSyncWithLocation
      filters={deviceCardFilters}
      sort={{ field: 'connectivity', order: 'DESC' }}
      queryOptions={{ refetchInterval: deviceStatusRefreshInterval, refetchIntervalInBackground: false }}
      title=' '
    >
      <WithListContext
        render={({ data }) => {
          const sortedData = sortDevicesByConnectivity(data ?? []);

          return (
          <Card sx={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
            <CardHeader title='Devices' />
            <CardContent sx={{ minHeight: 225, overflow: 'auto', flex: '1', p: 0 }}>
              <Table size='small' stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Fleet</TableCell>
                    <TableCell>UUID</TableCell>
                    <TableCell>Connection status</TableCell>
                    <TableCell>Connectivity</TableCell>
                    <TableCell>Release</TableCell>
                    <TableCell>Pinned release</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedData.map((record, index) => (
                    <TableRow key={record.id ?? index} hover>
                      <TableCell sx={{ maxWidth: 150 }}>
                        <Tooltip title={record['device name'] ?? ''}>
                          <Link to={`/device/${record.id}/show`}>
                            <span
                              style={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {record['device name'] || 'Unnamed device'}
                            </span>
                          </Link>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 140 }}>
                        <ReferenceField
                          record={record}
                          source='belongs to-application'
                          reference='application'
                          target='id'
                          link={false}
                        >
                          <FunctionField
                            render={(fleet) => (
                              <Tooltip title={fleet['app name'] ?? ''}>
                                <span>{fleet['app name']}</span>
                              </Tooltip>
                            )}
                          />
                        </ReferenceField>
                      </TableCell>
                      <TableCell>
                        <CopyChip title={record.uuid} label={record.uuid.substring(0, 8)} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <OnlineField record={record} source='api heartbeat state' />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <LastOnlineField record={record} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <ReferenceField
                          record={record}
                          source='is running-release'
                          reference='release'
                          target='id'
                          link={false}
                        >
                          <FunctionField render={(release) => getSemver(release)} />
                        </ReferenceField>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {record[isPinnedOnRelease] ? (
                          <ReferenceField
                            record={record}
                            source={isPinnedOnRelease}
                            reference='release'
                            target='id'
                            link={false}
                          >
                            <FunctionField render={(release) => getSemver(release)} />
                          </ReferenceField>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <CardActions sx={{ p: 0, whiteSpace: 'nowrap' }}>
                          <DeviceConnectButton
                            record={record}
                            label=''
                            size='small'
                            variant='outlined'
                            style={{ minWidth: '0' }}
                          />
                          <ShowButton
                            record={record}
                            label=''
                            size='small'
                            variant='outlined'
                            style={{ minWidth: '0' }}
                          />
                          <EditButton
                            record={record}
                            label=''
                            size='small'
                            variant='outlined'
                            style={{ minWidth: '0' }}
                          />
                          <EnvVarButton
                            resource='device'
                            record={record}
                            label=''
                            size='small'
                            variant='outlined'
                            style={{ minWidth: '0' }}
                          />
                        </CardActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          );
        }}
      />
    </List>
  </ResourceContextProvider>
);
