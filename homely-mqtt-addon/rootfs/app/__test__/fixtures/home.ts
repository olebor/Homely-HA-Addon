import { Device, Home } from '../../models/home';

const lastUpdated = '2026-01-01T00:00:00Z';

export const motionDevice: Device = {
  id: 'device-motion-1',
  name: 'Hallway motion',
  location: 'Hallway',
  modelId: 'model-1',
  modelName: 'Window/motion sensor Mini',
  serialNumber: 'SN-M-1',
  homeId: 'home-1',
  online: true,
  features: {
    alarm: {
      states: {
        alarm: { value: false, lastUpdated },
        tamper: { value: false, lastUpdated },
      },
    },
    temperature: {
      states: {
        temperature: { value: 21.5, lastUpdated },
      },
    },
    battery: {
      states: {
        low: { value: false, lastUpdated },
        voltage: { value: 3.0, lastUpdated },
      },
    },
    diagnostic: {
      states: {
        networklinkstrength: { value: -60, lastUpdated },
        networklinkaddress: { value: '0x1234', lastUpdated },
      },
    },
  },
};

export const doorDevice: Device = {
  ...motionDevice,
  id: 'device-door-1',
  name: 'Front door',
  modelName: 'Window/door sensor',
  online: false,
};

export const smokeDevice: Device = {
  ...motionDevice,
  id: 'device-smoke-1',
  name: 'Smoke alarm',
  modelName: 'Smoke alarm',
  features: {
    ...motionDevice.features,
    alarm: {
      states: {
        fire: { value: false, lastUpdated },
        tamper: { value: false, lastUpdated },
      },
    },
  },
};

export const buildHome = (devices: Device[] = [motionDevice]): Home => ({
  locationId: 'loc-1',
  gatewayserial: 'gw-1',
  name: 'Test Home',
  alarmState: 'DISARMED',
  userRoleAtLocation: 'owner',
  devices,
});
