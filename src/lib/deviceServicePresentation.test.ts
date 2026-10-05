import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deviceServiceTerminalTargets,
  deviceServiceLogSource,
  getServiceColors,
  hasSupervisorServiceTable,
  orderDeviceServices,
  matchesDeviceServiceLog,
  presentDeviceServices,
  queuedOsUpdateMode,
  relationshipId,
} from './deviceServicePresentation';

test('relationshipId reads scalar and expanded OData relationships', () => {
  assert.equal(relationshipId(12), 12);
  assert.equal(relationshipId({ id: 13 }), 13);
  assert.equal(relationshipId([{ __id: 14 }]), 14);
  assert.equal(relationshipId(null), undefined);
});

test('Supervisor service table starts at Supervisor 18.2.0', () => {
  assert.equal(hasSupervisorServiceTable('18.1.5'), false);
  assert.equal(hasSupervisorServiceTable('18.2.0'), true);
  assert.equal(hasSupervisorServiceTable('v19.2.1'), true);
  assert.equal(hasSupervisorServiceTable('unknown'), false);
});

test('queued Host OS update mode changes at Supervisor 19', () => {
  assert.equal(queuedOsUpdateMode('18.2.2'), 'cloudlink');
  assert.equal(queuedOsUpdateMode('v19.0.0'), 'supervisor');
  assert.equal(queuedOsUpdateMode(undefined), 'unknown');
});

test('service ordering is deterministic, natural and does not mutate API data', () => {
  const services = [
    { id: 12, serviceName: 'worker10' },
    { id: 9, serviceName: 'worker2' },
    { id: 3, serviceName: 'api' },
    { id: 2, serviceName: 'api' },
  ];
  assert.deepEqual(
    orderDeviceServices(services).map(({ id }) => id),
    [2, 3, 9, 12],
  );
  assert.deepEqual(
    services.map(({ id }) => id),
    [12, 9, 3, 2],
  );
});

const serviceFixture = {
  installs: [
    { 'id': 1, 'installs-image': [{ __id: 11 }], 'is provided by-release': { id: 200 }, 'status': 'Running' },
    { 'id': 2, 'installs-image': 12, 'is provided by-release': [{ id: 100 }], 'status': 'Running' },
    { 'id': 3, 'installs-image': 13, 'is provided by-release': 100, 'status': 'Stopped' },
    { 'id': 4, 'installs-image': 14, 'is provided by-release': 100, 'status': 'Running' },
    { 'id': 5, 'installs-image': 12, 'is provided by-release': 100, 'status': 'Running' },
    { 'id': 6, 'installs-image': 15, 'is provided by-release': 99, 'status': 'Running' },
  ],
  images: [
    { 'id': 11, 'is a build of-service': { id: 21 } },
    { 'id': 12, 'is a build of-service': [{ __id: 22 }] },
    { 'id': 13, 'is a build of-service': 23 },
    { 'id': 14, 'is a build of-service': 24 },
    { 'id': 15, 'is a build of-service': 25 },
  ],
  services: [
    { 'id': 21, 'service name': 'balena-supervisor' },
    { 'id': 22, 'service name': 'web' },
    { 'id': 23, 'service name': 'api' },
    { 'id': 24, 'service name': 'invalid;name' },
    { 'id': 25, 'service name': 'old-release' },
  ],
  appReleaseId: '100',
  supervisorReleaseId: 200,
  showSupervisorServices: true,
};

test('shared presentation groups App before Supervisor, resolves expanded relationships and excludes other releases', () => {
  const presentation = presentDeviceServices(serviceFixture);
  assert.deepEqual(
    presentation.appServices.map(({ serviceName }) => serviceName),
    ['api', 'invalid;name', 'web', 'web'],
  );
  assert.deepEqual(
    presentation.supervisorServices.map(({ serviceName }) => serviceName),
    ['balena-supervisor'],
  );
  assert.equal(presentation.services[presentation.services.length - 1]?.serviceName, 'balena-supervisor');
  assert.equal(
    presentDeviceServices({ ...serviceFixture, showSupervisorServices: false }).supervisorServices.length,
    0,
  );
});

test('terminal targets keep Host OS first, then App and Supervisor running service names without duplicate or invalid exec names', () => {
  assert.deepEqual(deviceServiceTerminalTargets(presentDeviceServices(serviceFixture).services), [
    { id: 'host', label: 'Host OS', target: 'host' },
    { id: 'container:web', label: 'web', target: 'container', container: 'web' },
    {
      id: 'container:supervisor:balena-supervisor',
      label: 'balena-supervisor',
      target: 'container',
      container: 'balena-supervisor',
    },
  ]);
  assert.deepEqual(deviceServiceTerminalTargets([]), [{ id: 'host', label: 'Host OS', target: 'host' }]);
});

test('missing service relationships retain visible table rows but never create terminal targets', () => {
  const presentation = presentDeviceServices({ ...serviceFixture, images: [], services: [] });
  assert.equal(presentation.appServices.length, 4);
  assert.equal(presentation.appServices[0].serviceName, 'Unknown service');
  assert.equal(deviceServiceTerminalTargets(presentation.services).length, 1);
});

test('Supervisor core uses the explicit supervisor selector while App core keeps ordinary exec targeting and unique picker IDs', () => {
  const presentation = presentDeviceServices({
    ...serviceFixture,
    services: serviceFixture.services.map((service) =>
      service.id === 21 || service.id === 22 ? { ...service, 'service name': 'core' } : service,
    ),
  });
  assert.deepEqual(deviceServiceTerminalTargets(presentation.services), [
    { id: 'host', label: 'Host OS', target: 'host' },
    { id: 'container:core', label: 'core', target: 'container', container: 'core' },
    { id: 'container:supervisor:core', label: 'core', target: 'container', container: 'balena_supervisor' },
  ]);
});

test('only Supervisor-group core uses default logs, preserving its service ID and excluding other app/system logs', () => {
  const presentation = presentDeviceServices({
    ...serviceFixture,
    services: serviceFixture.services.map((service) =>
      service.id === 21 || service.id === 22 ? { ...service, 'service name': 'core' } : service,
    ),
  });
  const supervisorCore = presentation.supervisorServices[0];
  const appCore = presentation.appServices.find(({ serviceName }) => serviceName === 'core')!;
  assert.equal(deviceServiceLogSource(supervisorCore), 'supervisor');
  assert.equal(deviceServiceLogSource(appCore), 'service');
  assert.equal(deviceServiceLogSource({ serviceName: 'core-next', serviceGroup: 'supervisor' }), 'service');
  assert.equal(deviceServiceLogSource({ serviceName: 'core' }), 'service');

  const logs = [
    { message: 'default supervisor', isSystem: true },
    { message: 'null supervisor', serviceId: null },
    { message: 'tagged supervisor', serviceId: '21' },
    { message: 'app core', serviceId: 22 },
    { message: 'other app system message', serviceId: 23, isSystem: true },
  ];
  const supervisorSelection = {
    serviceId: Number(supervisorCore.serviceId),
    logSource: deviceServiceLogSource(supervisorCore),
  };
  assert.equal(supervisorSelection.serviceId, 21);
  assert.deepEqual(
    logs.filter((entry) => matchesDeviceServiceLog(entry, supervisorSelection)).map(({ message }) => message),
    ['default supervisor', 'null supervisor', 'tagged supervisor'],
  );
  assert.deepEqual(
    logs
      .filter((entry) =>
        matchesDeviceServiceLog(entry, {
          serviceId: Number(appCore.serviceId),
          logSource: deviceServiceLogSource(appCore),
        }),
      )
      .map(({ message }) => message),
    ['app core'],
  );
  assert.deepEqual(
    logs.filter((entry) => matchesDeviceServiceLog(entry, { serviceId: 0 })).map(({ message }) => message),
    ['default supervisor', 'null supervisor'],
  );
});

test('service background colors are stable, distinct for common services and readable on both themes', () => {
  const names = ['Host OS', 'api', 'web', 'worker', 'balena-supervisor', 'balena-cloudlink'];
  const colors = names.map(getServiceColors);
  assert.equal(new Set(colors.map(({ backgroundColor }) => backgroundColor)).size, names.length);
  const luminance = (rgb: number[]) =>
    rgb
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const [index, color] of colors.entries()) {
    assert.deepEqual(getServiceColors(names[index]), color);
    const match = /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(color.backgroundColor);
    assert.ok(match);
    const hue = Number(match[1]) / 60;
    const saturation = Number(match[2]) / 100;
    const lightness = Number(match[3]) / 100;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const secondary = chroma * (1 - Math.abs((hue % 2) - 1));
    const rgb = [
      [chroma, secondary, 0],
      [secondary, chroma, 0],
      [0, chroma, secondary],
      [0, secondary, chroma],
      [secondary, 0, chroma],
      [chroma, 0, secondary],
    ][Math.floor(hue)].map((value) => value + lightness - chroma / 2);
    const foreground = color.color.match(/[a-f0-9]{2}/g)!.map((value) => parseInt(value, 16) / 255);
    assert.ok((luminance(rgb) + 0.05) / (luminance(foreground) + 0.05) >= 4.5);
  }
});
