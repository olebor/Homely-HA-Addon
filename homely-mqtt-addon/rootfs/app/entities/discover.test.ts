import { describe, expect, it, vi } from 'vitest';
import { buildConfigMock } from '../__test__/mock-config';
import {
  buildHome,
  doorDevice,
  motionDevice,
  smokeDevice,
} from '../__test__/fixtures/home';

vi.mock('config', () => buildConfigMock());

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Imported lazily after mocks so the module-level config.get calls hit the stub.
const loadDiscover = async () => await import('./discover');

describe('capitalize', () => {
  it('uppercases the first character', async () => {
    const { capitalize } = await loadDiscover();
    expect(capitalize('foo')).toBe('Foo');
  });

  it('leaves an already-capitalized string alone', async () => {
    const { capitalize } = await loadDiscover();
    expect(capitalize('Bar')).toBe('Bar');
  });

  it('returns NOT_AVAILABLE for an empty string', async () => {
    const { capitalize } = await loadDiscover();
    expect(capitalize('')).toBe('NOT_AVAILABLE');
  });
});

describe('discoverDevice', () => {
  it('matches sensors whose path resolves on the device', async () => {
    const { discoverDevice } = await loadDiscover();
    const matched = discoverDevice(motionDevice);
    const names = matched.map((s) => s.name);
    expect(names).toContain('motion');
    expect(names).toContain('temperature');
    expect(names).toContain('battery_low');
  });

  it('resolves the alarm sensor name via getName(device) for motion devices', async () => {
    const { discoverDevice } = await loadDiscover();
    const matched = discoverDevice(motionDevice);
    const alarm = matched.find((s) => s.path === 'alarm.states.alarm.value');
    expect(alarm?.name).toBe('motion');
  });

  it('resolves the alarm sensor name to "contact" for door devices', async () => {
    const { discoverDevice } = await loadDiscover();
    const matched = discoverDevice(doorDevice);
    const alarm = matched.find((s) => s.path === 'alarm.states.alarm.value');
    expect(alarm?.name).toBe('contact');
  });

  it('does not match the alarm sensor when the path is absent', async () => {
    const { discoverDevice } = await loadDiscover();
    const matched = discoverDevice(smokeDevice);
    const alarm = matched.find((s) => s.path === 'alarm.states.alarm.value');
    expect(alarm).toBeUndefined();
    // but fire should match, since smokeDevice has alarm.states.fire
    const fire = matched.find((s) => s.path === 'alarm.states.fire.value');
    expect(fire).toBeDefined();
  });
});

describe('discover', () => {
  it('builds MQTT topics with the configured prefixes and underscore sensor names', async () => {
    const { discover } = await loadDiscover();
    const entries = discover(buildHome([motionDevice]));

    const temp = entries.find((e) => e.path === 'temperature.states.temperature.value');
    expect(temp?.config_topic).toBe(
      `homeassistant/sensor/${motionDevice.id}/temperature/config`
    );
    expect(temp?.availability_topic).toBe(`homely/${motionDevice.id}/online`);
    expect(temp?.state_topic).toBe(`homely/${motionDevice.id}/temperature/state`);

    const batteryLow = entries.find((e) => e.path === 'battery.states.low.value');
    // state_topic keeps the raw sensor name (underscored) for HA stability
    expect(batteryLow?.state_topic).toBe(`homely/${motionDevice.id}/battery_low/state`);
  });

  it('capitalizes the name and replaces underscores with spaces', async () => {
    const { discover } = await loadDiscover();
    const home = buildHome([motionDevice]);
    const entries = discover(home);
    const batteryLow = entries.find((e) => e.path === 'battery.states.low.value');
    expect(batteryLow?.name).toBe('Battery low');
  });

  it('propagates the device online flag to each entry', async () => {
    const { discover } = await loadDiscover();
    const home = buildHome([motionDevice, doorDevice]);
    const entries = discover(home);

    const motionEntries = entries.filter((e) => e.device_id === motionDevice.id);
    const doorEntries = entries.filter((e) => e.device_id === doorDevice.id);

    expect(motionEntries.length).toBeGreaterThan(0);
    expect(doorEntries.length).toBeGreaterThan(0);
    expect(motionEntries.every((e) => e.online === true)).toBe(true);
    expect(doorEntries.every((e) => e.online === false)).toBe(true);
  });

  it('falls back to getDeviceClass when deviceClass is absent', async () => {
    const { discover } = await loadDiscover();
    const entries = discover(buildHome([motionDevice]));
    const alarmEntry = entries.find(
      (e) => e.device_id === motionDevice.id && e.path === 'alarm.states.alarm.value'
    );
    expect(alarmEntry?.device_class).toBe('motion');

    const doorEntries = discover(buildHome([doorDevice]));
    const doorAlarm = doorEntries.find((e) => e.path === 'alarm.states.alarm.value');
    expect(doorAlarm?.device_class).toBe('door');
  });

  it('flattens across multiple devices', async () => {
    const { discover } = await loadDiscover();
    const entries = discover(buildHome([motionDevice, doorDevice]));
    const deviceIds = new Set(entries.map((e) => e.device_id));
    expect(deviceIds).toEqual(new Set([motionDevice.id, doorDevice.id]));
  });
});
