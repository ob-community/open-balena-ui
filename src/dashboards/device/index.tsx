import * as React from 'react';
import { Show } from 'react-admin';
import DashboardLayout from './dashboardLayout';
import { useParams } from 'react-router-dom';
import { DeviceRefreshProvider } from '../../ui/DeviceRefreshContext';

const DeviceDashboard: React.FC = () => {
  const { id } = useParams();
  if (id == null) return null;
  return (
    <DeviceRefreshProvider key={id} deviceId={id}>
      <Show
        component='div'
        title='Device Dashboard'
        actions={false}
        queryOptions={{ refetchInterval: false, refetchOnMount: false }}
      >
        <DashboardLayout />
      </Show>
    </DeviceRefreshProvider>
  );
};

export default DeviceDashboard;
