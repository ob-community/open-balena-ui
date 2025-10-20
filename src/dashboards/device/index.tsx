import * as React from 'react';
import { Show } from 'react-admin';
import DashboardLayout from './dashboardLayout';

const DeviceDashboard = () => {
  return (
    <Show component='div' title='Device Dashboard' actions={false}>
      <DashboardLayout />
    </Show>
  );
};

export default DeviceDashboard;
