import { CssBaseline } from '@mui/material';
import * as React from 'react';
import { Admin, CustomRoutes, Layout, Resource, fetchUtils } from 'react-admin';
import { Navigate, Route, useParams } from 'react-router-dom';
import type { Options } from 'ra-core';
import openbalenaAuthProvider from './authProvider/openbalenaAuthProvider';
import apiKey from './components/apiKey';
import config from './components/config';
import cpuArchitecture from './components/cpuArchitecture';
import device from './components/device';
import deviceConfigVar from './components/deviceConfigVar';
import deviceEnvVar from './components/deviceEnvVar';
import deviceFamily from './components/deviceFamily';
import deviceManufacturer from './components/deviceManufacturer';
import deviceServiceVar from './components/deviceServiceVar';
import deviceTag from './components/deviceTag';
import deviceType from './components/deviceType';
import deviceTypeAlias from './components/deviceTypeAlias';
import fleet from './components/fleet';
import fleetConfigVar from './components/fleetConfigVar';
import fleetEnvVar from './components/fleetEnvVar';
import fleetTag from './components/fleetTag';
import fleetType from './components/fleetType';
import image from './components/image';
import imageEnvVar from './components/imageEnvVar';
import imageLabel from './components/imageLabel';
import organization from './components/organization';
import permission from './components/permission';
import release from './components/release';
import releaseTag from './components/releaseTag';
import role from './components/role';
import service from './components/service';
import serviceEnvVar from './components/serviceEnvVar';
import serviceLabel from './components/serviceLabel';
import user from './components/user';
import userKey from './components/userKey';
import DeviceDashboard from './dashboards/device';
import MainDashboard from './dashboards/main';
import postgrestDataProvider from './dataProvider/postgrestDataProvider';
import TreeMenu from './ui/TreeMenu';
import customTheme from './ui/customTheme';
import versions from './versions';
import environment from './lib/reactAppEnv';

const httpClient = (url: string, options: Options = {}): ReturnType<typeof fetchUtils.fetchJson> => {
  const headers = new Headers((options.headers as HeadersInit) ?? { Accept: 'application/json' });
  const token = localStorage.getItem('auth');
  headers.set('Authorization', `Bearer ${token ?? ''}`);

  return fetchUtils.fetchJson(url, { ...options, headers });
};

const dataProvider = postgrestDataProvider(environment.REACT_APP_OPEN_BALENA_POSTGREST_URL, httpClient);

const deviceTypeAliasVer = versions.resource('deviceTypeAlias', environment.REACT_APP_OPEN_BALENA_API_VERSION);

const App: React.FC = () => <OpenBalenaAdmin />;

const NavigateToDevice: React.FC = () => {
  const { uuid } = useParams<{ uuid?: string }>();
  const targetUuid = uuid ?? '';
  return <Navigate to={`/#/device/0/show?uuid=${targetUuid}`} replace />;
};

const customRoutes: React.ReactElement[] = [
  <Route key='custom-route-device-summary' path='/devices/:uuid/summary' element={<NavigateToDevice />} />,
];

const treeLayout: React.FC<React.ComponentProps<typeof Layout>> = (props) => {
  return (
    <>
      <Layout {...props} sidebar={TreeMenu} />
      <CssBaseline />
    </>
  );
};

const OpenBalenaAdmin: React.FC = () => (
  <Admin
    requireAuth
    title='Open Balena Admin'
    disableTelemetry={true}
    dataProvider={dataProvider}
    authProvider={openbalenaAuthProvider}
    dashboard={MainDashboard}
    layout={treeLayout}
    theme={customTheme}
  >
    <CustomRoutes>{customRoutes}</CustomRoutes>
    <Resource name='menu-access' options={{ label: 'Access', isMenuParent: true }} />
    <Resource name='organization' options={{ label: 'Orgs', menuParent: 'menu-access' }} {...organization} />
    <Resource name='user' options={{ label: 'Users', menuParent: 'menu-access' }} {...user} />
    <Resource name='api key' options={{ label: 'API Keys', menuParent: 'menu-access' }} {...apiKey} />
    <Resource name='user-has-public key' options={{ label: 'SSH Keys', menuParent: 'menu-access' }} {...userKey} />

    <Resource name='menu-fleet' options={{ label: 'Fleets', isMenuParent: true }} />
    <Resource name='application' options={{ label: 'Fleets', menuParent: 'menu-fleet' }} {...fleet} />
    <Resource
      name='application config variable'
      options={{ label: 'Config Vars', menuParent: 'menu-fleet' }}
      {...fleetConfigVar}
    />
    <Resource
      name='application environment variable'
      options={{ label: 'Environment Vars', menuParent: 'menu-fleet' }}
      {...fleetEnvVar}
    />
    <Resource name='application tag' options={{ label: 'Tags', menuParent: 'menu-fleet' }} {...fleetTag} />

    <Resource name='menu-device' options={{ label: 'Devices', isMenuParent: true }} />
    <Resource
      name='device'
      options={{ label: 'Devices', menuParent: 'menu-device' }}
      {...device}
      show={DeviceDashboard}
    />
    <Resource
      name='device config variable'
      options={{ label: 'Config Vars', menuParent: 'menu-device' }}
      {...deviceConfigVar}
    />
    <Resource
      name='device environment variable'
      options={{ label: 'Environment Vars', menuParent: 'menu-device' }}
      {...deviceEnvVar}
    />
    <Resource
      name='device service environment variable'
      options={{ label: 'Service Vars', menuParent: 'menu-device' }}
      {...deviceServiceVar}
    />
    <Resource name='device tag' options={{ label: 'Tags', menuParent: 'menu-device' }} {...deviceTag} />

    <Resource name='menu-image' options={{ label: 'Images', isMenuParent: true }} />
    <Resource name='image' options={{ label: 'Images', menuParent: 'menu-image' }} {...image} />
    <Resource
      name='image environment variable'
      options={{ label: 'Environment Vars', menuParent: 'menu-image' }}
      {...imageEnvVar}
    />
    <Resource name='image label' options={{ label: 'Labels', menuParent: 'menu-image' }} {...imageLabel} />

    <Resource name='menu-release' options={{ label: 'Releases', isMenuParent: true }} />
    <Resource name='release' options={{ label: 'Releases', menuParent: 'menu-release' }} {...release} />
    <Resource name='release tag' options={{ label: 'Tags', menuParent: 'menu-release' }} {...releaseTag} />

    <Resource name='menu-service' options={{ label: 'Services', isMenuParent: true }} />
    <Resource name='service' options={{ label: 'Services', menuParent: 'menu-service' }} {...service} />
    <Resource
      name='service environment variable'
      options={{ label: 'Environment Vars', menuParent: 'menu-service' }}
      {...serviceEnvVar}
    />
    <Resource name='service label' options={{ label: 'Labels', menuParent: 'menu-service' }} {...serviceLabel} />

    <Resource name='menu-static' options={{ label: 'Static Data', isMenuParent: true }} />
    <Resource name='config' options={{ label: 'Configs', menuParent: 'menu-static' }} {...config} />
    <Resource
      name='cpu architecture'
      options={{ label: 'CPU Architectures', menuParent: 'menu-static' }}
      {...cpuArchitecture}
    />
    <Resource
      name='device family'
      options={{ label: 'Device Families', menuParent: 'menu-static' }}
      {...deviceFamily}
    />
    <Resource
      name='device manufacturer'
      options={{ label: 'Device Mfgs', menuParent: 'menu-static' }}
      {...deviceManufacturer}
    />
    <Resource name='device type' options={{ label: 'Device Types', menuParent: 'menu-static' }} {...deviceType} />
    {deviceTypeAliasVer ? (
      <Resource
        name='device type alias'
        options={{ label: 'DT Aliases', menuParent: 'menu-static' }}
        {...deviceTypeAlias}
      />
    ) : (
      <></>
    )}
    <Resource name='application type' options={{ label: 'Fleet Types', menuParent: 'menu-static' }} {...fleetType} />
    <Resource name='permission' options={{ label: 'Permissions', menuParent: 'menu-static' }} {...permission} />
    <Resource name='role' options={{ label: 'Roles', menuParent: 'menu-static' }} {...role} />

    {/* Reference tables */}
    <Resource name='actor' />
    <Resource name='api key-has-permission' />
    <Resource name='api key-has-role' />
    <Resource name='image install' />
    <Resource name='image-is part of-release' />
    <Resource name='migration' />
    <Resource name='migration lock' />
    <Resource name='model' />
    <Resource name='organization membership' />
    <Resource name='role-has-permission' />
    <Resource name='service install' />
    <Resource name='service instance' />
    <Resource name='user-has-permission' />
    <Resource name='user-has-role' />
  </Admin>
);

export default App;
