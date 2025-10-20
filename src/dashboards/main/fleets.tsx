import React from 'react';
import {
  ChipField,
  FunctionField,
  List,
  ReferenceField,
  ReferenceManyCount,
  ResourceContextProvider,
  SearchInput,
  WithListContext,
} from 'react-admin';
import AddIcon from '@mui/icons-material/Add';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
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

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

const fleetCardFilters = [<SearchInput source='#app name,is of-class@ilike' alwaysOn />];

export const FleetCards = () => (
  <ResourceContextProvider value='application'>
    <List emptyWhileLoading disableSyncWithLocation filters={fleetCardFilters} title=' '>
      <WithListContext
        render={({ data }) => (
          <Card sx={{ flex: '1', dispay: 'flex', flexDirection: 'column' }}>
            <CardHeader title='Fleets' />
            <CardContent sx={{ minHeight: 225, overflow: 'auto', flex: '1', display: 'flex', flexDirection: 'column' }}>
              <Grid container spacing={3} sx={{ flex: '1' }}>
                {data?.map((record, index) => (
                  <Grid item key={index} xs='auto'>
                    <Card sx={{ minWidth: 200, maxWidth: 200, minHeight: 220, maxHeight: 220 }}>
                      <CardHeader
                        title={<Tooltip title={record['app name']}>{record['app name']}</Tooltip>}
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
                              <TableCell colSpan={2}>
                                <ReferenceField
                                  record={record}
                                  source='organization'
                                  reference='organization'
                                  target='id'
                                >
                                  <ChipField
                                    icon={<CorporateFareIcon />}
                                    source='name'
                                    variant='outlined'
                                    style={{ width: '100%', justifyContent: 'space-between', paddingLeft: '5px' }}
                                  />
                                </ReferenceField>
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell colSpan={2}>
                                <ReferenceField
                                  record={record}
                                  source='is for-device type'
                                  reference='device type'
                                  target='id'
                                >
                                  <ChipField
                                    icon={<DeveloperBoardIcon />}
                                    source='name'
                                    variant='outlined'
                                    style={{ width: '100%', justifyContent: 'space-between', paddingLeft: '5px' }}
                                  />
                                </ReferenceField>
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Class</TableCell>
                              <TableCell align='right'>{record['is of-class']}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Rel.</TableCell>
                              <TableCell
                                align='right'
                                sx={{
                                  variant: 'inherit',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 126,
                                }}
                              >
                                <ReferenceField
                                  record={record}
                                  label='Target Rel.'
                                  source={isPinnedOnRelease}
                                  reference='release'
                                  target='id'
                                >
                                  <FunctionField label='API Key' render={(record) => getSemver(record)} />
                                </ReferenceField>
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Online</TableCell>
                              <TableCell align='right'>
                                <ReferenceManyCount
                                  record={record}
                                  source='id'
                                  reference='device'
                                  target='belongs to-application'
                                  filter={{ 'api heartbeat state': 'online' }}
                                />{' '}
                                /{' '}
                                <ReferenceManyCount
                                  record={record}
                                  source='id'
                                  reference='device'
                                  target='belongs to-application'
                                />
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
