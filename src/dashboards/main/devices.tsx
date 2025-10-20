import React from 'react';
import {
  ChipField,
  List,
  ReferenceField,
  ResourceContextProvider,
  SearchInput,
  ShowButton,
  WithListContext,
} from 'react-admin';
import GrainIcon from '@mui/icons-material/Grain';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import {
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
import DeviceConnectButton from '../../ui/DeviceConnectButton';
import { OnlineField } from '../../components/device';

const deviceCardFilters = [<SearchInput source='#uuid,device name,status@ilike' alwaysOn />];

export const DeviceCards = () => (
  <ResourceContextProvider value='device'>
    <List emptyWhileLoading disableSyncWithLocation filters={deviceCardFilters} title=' '>
      <WithListContext
        render={({ data }) => (
          <Card sx={{ flex: '1', dispay: 'flex', flexDirection: 'column' }}>
            <CardHeader title='Devices' />
            <CardContent sx={{ minHeight: 225, overflow: 'auto', flex: '1', display: 'flex', flexDirection: 'column' }}>
              <Grid container spacing={3} sx={{ flex: '1' }}>
                {data?.map((record, index) => (
                  <Grid item key={index} xs='auto'>
                    <Card sx={{ minWidth: 200, maxWidth: 200, minHeight: 220, maxHeight: 220 }}>
                      <CardHeader
                        title={
                          <Tooltip title={record['device name']}>
                            {record['device name'].length > 0 ? record['device name'] : <br />}
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
                              <TableCell colSpan={2}>
                                <ReferenceField
                                  record={record}
                                  source='belongs to-application'
                                  reference='application'
                                  target='id'
                                >
                                  <ChipField
                                    icon={<GrainIcon />}
                                    source='app name'
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
                                  source='is of-device type'
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
                              <TableCell sx={{ fontWeight: 'bold' }}>UUID</TableCell>
                              <TableCell align='right'>{record.uuid.substring(0, 8)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                              <TableCell align='right'>
                                <OnlineField record={record} source='api heartbeat state' />
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>OS</TableCell>
                              <TableCell
                                align='right'
                                sx={{
                                  variant: 'inherit',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 125,
                                }}
                              >
                                <Tooltip title={record['os version'] ? record['os version'].split(' ')[1] : 'n/a'}>
                                  {record['os version'] ? record['os version'].split(' ')[1] : 'n/a'}
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                      <CardActions sx={{ paddingTop: '0px', paddingBottom: '4px' }}>
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
