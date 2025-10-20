import { Box, Card, useTheme } from '@mui/material';
import React from 'react';
import { TabbedShowLayout, Title, useRecordContext } from 'react-admin';
import DeviceConnect from '../../ui/DeviceConnect';
import DeviceLogs from '../../ui/DeviceLogs';
import DeviceServices from '../../ui/DeviceServices';
import ControlsWidget from './controlsWidget';
import UsageWidget from './usageWidget';
import ConfigVarsWidget from './configVarsWidget';
import EnvVarsWidget from './envVarsWidget';
import ServiceVarsWidget from './serviceVarsWidget';
import TagsWidget from './tagsWidget';
import DeviceConnectButton from '../../ui/DeviceConnectButton';
import { OpenInFull } from '@mui/icons-material';
import SummaryWidget from './summaryWidget';

const DashboardLayout = () => {
  const record = useRecordContext();
  const theme = useTheme();

  if (!record) {
    return null;
  }

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 2, margin: '7.5px', minWidth: '600px' }}>
          <Card style={{ padding: '15px' }}>
            <ControlsWidget />
          </Card>

          <Card sx={{ padding: '15px', marginTop: '15px' }}>
            <Title title='/' />
            <TabbedShowLayout>
              <TabbedShowLayout.Tab label='Summary'>
                <SummaryWidget />
              </TabbedShowLayout.Tab>
              <TabbedShowLayout.Tab label='Config Vars'>
                <ConfigVarsWidget />
              </TabbedShowLayout.Tab>
              <TabbedShowLayout.Tab label='Env Vars'>
                <EnvVarsWidget />
              </TabbedShowLayout.Tab>
              <TabbedShowLayout.Tab label='Service Vars'>
                <ServiceVarsWidget />
              </TabbedShowLayout.Tab>
              <TabbedShowLayout.Tab label='Tags'>
                <TagsWidget />
              </TabbedShowLayout.Tab>
            </TabbedShowLayout>
          </Card>

          <Card sx={{ padding: '15px', marginTop: '15px' }}>
            <DeviceServices device={record} />
          </Card>
        </div>

        <div style={{ flex: 3, margin: '7.5px', minWidth: '550px' }}>
          <Card sx={{ padding: '15px' }}>
            <UsageWidget />
          </Card>

          <Card sx={{ padding: 0, marginTop: '15px' }}>
            <DeviceLogs />
          </Card>

          <Card sx={{ padding: 0, marginTop: '15px' }}>
            <DeviceConnectButton
              style={{
                float: 'right',
                color: theme.palette.text.primary,
                backgroundColor: 'white',
                marginTop: '8px',
                marginLeft: '-15px',
              }}
              connectIcon={<OpenInFull />}
              connectIconTooltip='Open Fullscreen View'
            />
            <DeviceConnect />
          </Card>
        </div>
      </Box>
    </>
  );
};

export default DashboardLayout;
