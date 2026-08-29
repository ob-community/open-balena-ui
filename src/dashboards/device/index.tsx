import * as React from 'react';
import { Show } from 'react-admin';
import DashboardLayout from './dashboardLayout';

const DeviceDashboard: React.FC = () => {
  return (
    <Show
      component='div'
      title='Device Dashboard'
      actions={false}
      queryOptions={{ refetchInterval: 30000, refetchIntervalInBackground: false }}
    >
      <DashboardLayout />
    </Show>
  );
};

export default DeviceDashboard;
