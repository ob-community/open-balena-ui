import React from 'react';
import {
  Link,
  List,
  ReferenceManyCount,
  ResourceContextProvider,
  SearchInput,
  WithListContext,
  useGetList,
  useGetOne,
} from 'react-admin';
import AddIcon from '@mui/icons-material/Add';
import DevicesIcon from '@mui/icons-material/Devices';
import {
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
} from '@mui/material';
import { tableCellClasses } from '@mui/material/TableCell';
import { EditButton } from 'react-admin';
import EnvVarButton from '../../ui/EnvVarButton';
import { getSemver } from '../../ui/SemVerChip';
import versions from '../../versions';
import environment from '../../lib/reactAppEnv';
import { resolveFleetTargetRelease } from '../../lib/targetRelease';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
const fleetStatusRefreshInterval = 30000;
const fleetCountQueryOptions = {
  refetchInterval: fleetStatusRefreshInterval,
  refetchIntervalInBackground: false,
};

const fleetCardFilters = [<SearchInput source='#app name,is of-class@ilike' alwaysOn />];

const LatestFleetReleaseVersion: React.FC<{ fleetId: string | number }> = ({ fleetId }) => {
  const { data, isPending } = useGetList('release', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'DESC' },
    filter: { 'belongs to-application': fleetId },
  });

  if (isPending) {
    return <>…</>;
  }

  return <>{data?.[0] ? getSemver(data[0]) : '—'}</>;
};

const FleetReleaseVersion: React.FC<{ record: Record<string, any> }> = ({ record }) => {
  const { targetReleaseId } = resolveFleetTargetRelease({ record, pinField: isPinnedOnRelease });
  const hasTargetRelease = targetReleaseId !== undefined && targetReleaseId !== null;
  const { data: targetRelease, isPending, isError } = useGetOne(
    'release',
    { id: hasTargetRelease ? targetReleaseId : '' },
    { enabled: hasTargetRelease },
  );

  if (!hasTargetRelease) {
    return <LatestFleetReleaseVersion fleetId={record.id} />;
  }

  if (isPending) {
    return <>…</>;
  }

  return !isError && targetRelease ? <>{getSemver(targetRelease)}</> : '—';
};

export const FleetCards: React.FC = () => (
  <ResourceContextProvider value='application'>
    <List
      emptyWhileLoading
      disableSyncWithLocation
      filters={fleetCardFilters}
      queryOptions={{ refetchInterval: fleetStatusRefreshInterval, refetchIntervalInBackground: false }}
      title=' '
    >
      <WithListContext
        render={({ data }) => (
          <Card sx={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
            <CardHeader title='Fleets' />
            <CardContent sx={{ minHeight: 225, overflow: 'auto', flex: '1', display: 'flex', flexDirection: 'column' }}>
              <Grid container spacing={3} sx={{ flex: '1' }}>
                {data?.map((record, index) => (
                  <Grid item key={index} xs='auto'>
                    <Card sx={{ minWidth: 200, maxWidth: 200, minHeight: 220, maxHeight: 220 }}>
                      <CardHeader
                        title={
                          <Tooltip title={record['app name']}>
                            <Link to={`/application/${record.id}/show`}>
                              {record['app name']}
                            </Link>
                          </Tooltip>
                        }
                        sx={{ fontWeight: 'bold', height: '45px' }}
                        titleTypographyProps={{
                          variant: 'inherit',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 165,
                        }}
                      />
                      <CardContent sx={{ paddingTop: '4px', paddingBottom: '4px' }}>
                        <Table
                          sx={{
                            [`& .${tableCellClasses.root}`]: {
                              borderBottom: 'none',
                              paddingLeft: '0px',
                              paddingRight: '0px',
                              paddingTop: '2px',
                              paddingBottom: '2px',
                            },
                          }}
                        >
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Devices</TableCell>
                              <TableCell
                                align='right'
                                sx={{
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <ReferenceManyCount
                                  record={record}
                                  source='id'
                                  reference='device'
                                  target='belongs to-application'
                                  filter={{ 'is connected to vpn': true }}
                                  queryOptions={fleetCountQueryOptions}
                                />{' '}
                                /{' '}
                                <ReferenceManyCount
                                  record={record}
                                  source='id'
                                  reference='device'
                                  target='belongs to-application'
                                  queryOptions={fleetCountQueryOptions}
                                />
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Fleet pin</TableCell>
                              <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                                <FleetReleaseVersion record={record} />
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Following pin</TableCell>
                              <TableCell align='right'>
                                {record[isPinnedOnRelease] ? (
                                  <ReferenceManyCount
                                    record={record}
                                    source='id'
                                    reference='device'
                                    target='belongs to-application'
                                    filter={{ [`${isPinnedOnRelease}@is`]: 'null' }}
                                    queryOptions={fleetCountQueryOptions}
                                  />
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                      <CardActions sx={{ paddingTop: '0px', paddingBottom: '4px' }}>
                        <Button
                          href={`/#/device?filter={"belongs to-application": ${record['id']}}`}
                          size='small'
                          variant='outlined'
                          style={{ minWidth: '0' }}
                        >
                          <DevicesIcon />
                        </Button>

                        <Button
                          href={`/#/device/create?source={"belongs to-application": ${record['id']}}`}
                          size='small'
                          variant='outlined'
                          style={{ minWidth: '0' }}
                        >
                          <AddIcon />
                        </Button>

                        <EditButton
                          record={record}
                          label=''
                          size='small'
                          variant='outlined'
                          style={{ minWidth: '0' }}
                        />

                        <EnvVarButton
                          resource='application'
                          record={record}
                          label=''
                          size='small'
                          variant='outlined'
                          style={{ minWidth: '0' }}
                        />
                      </CardActions>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        )}
      />
    </List>
  </ResourceContextProvider>
);
