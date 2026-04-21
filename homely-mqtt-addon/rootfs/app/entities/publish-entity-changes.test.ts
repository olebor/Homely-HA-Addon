import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InferCreationAttributes } from 'sequelize';
import type { HomelyFeature } from '../db';
import { motionDevice } from '../__test__/fixtures/home';

const mqttPublish = vi.fn();
const loggerMocks = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

vi.mock('../utils/mqtt', () => ({
  mqttClient: { publish: mqttPublish },
}));

vi.mock('../utils/logger', () => ({
  logger: loggerMocks,
}));

const loadPublish = async () => await import('./publish-entity-changes');

describe('publish', () => {
  afterEach(() => {
    mqttPublish.mockReset();
  });

  it('converts true to "ON"', async () => {
    const { publish } = await loadPublish();
    publish('state/topic', true);
    expect(mqttPublish).toHaveBeenCalledWith('state/topic', 'ON', { qos: 1, retain: true });
  });

  it('converts false to "OFF"', async () => {
    const { publish } = await loadPublish();
    publish('state/topic', false);
    expect(mqttPublish).toHaveBeenCalledWith('state/topic', 'OFF', { qos: 1, retain: true });
  });

  it('stringifies numeric values', async () => {
    const { publish } = await loadPublish();
    publish('state/topic', 21.5);
    expect(mqttPublish).toHaveBeenCalledWith('state/topic', '21.5', { qos: 1, retain: true });
  });

  it('passes strings through unchanged', async () => {
    const { publish } = await loadPublish();
    publish('state/topic', 'DISARMED');
    expect(mqttPublish).toHaveBeenCalledWith('state/topic', 'DISARMED', { qos: 1, retain: true });
  });

  it('does nothing when value is undefined', async () => {
    const { publish } = await loadPublish();
    publish('state/topic', undefined as unknown as string);
    expect(mqttPublish).not.toHaveBeenCalled();
  });

  it('does nothing when value is null', async () => {
    const { publish } = await loadPublish();
    publish('state/topic', null as unknown as string);
    expect(mqttPublish).not.toHaveBeenCalled();
  });
});

const feature = (
  overrides: Partial<InferCreationAttributes<HomelyFeature>>
): InferCreationAttributes<HomelyFeature> =>
  ({
    id: 'f-1',
    device_id: motionDevice.id,
    device_id_suffix: `${motionDevice.id}_temperature`,
    path: 'temperature.states.temperature.value',
    format: 'number',
    unit: '°C',
    type: 'sensor',
    device_class: 'temperature',
    name: 'Temperature',
    config_topic: `homeassistant/sensor/${motionDevice.id}/temperature/config`,
    availability_topic: `homely/${motionDevice.id}/online`,
    state_topic: `homely/${motionDevice.id}/temperature/state`,
    state_class: 'measurement',
    ...overrides,
  }) as InferCreationAttributes<HomelyFeature>;

describe('publishEntityChanges', () => {
  // process.exit() normally halts the node process; the source relies on
  // that to avoid executing the rest of the loop. In tests we substitute
  // a throw so the loop aborts the same way.
  const EXIT_SENTINEL = new Error('__test_process_exit__');
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw EXIT_SENTINEL;
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    mqttPublish.mockReset();
    loggerMocks.fatal.mockReset();
  });

  it('publishes the value at the feature path for the matching device', async () => {
    const { publishEntityChanges } = await loadPublish();
    await publishEntityChanges([feature({})], [motionDevice]);
    expect(mqttPublish).toHaveBeenCalledWith(
      `homely/${motionDevice.id}/temperature/state`,
      '21.5',
      { qos: 1, retain: true }
    );
  });

  it('logs fatal and exits when the device is missing from the lookup', async () => {
    const { publishEntityChanges } = await loadPublish();
    await expect(
      publishEntityChanges([feature({ device_id: 'missing-device' })], [motionDevice])
    ).rejects.toBe(EXIT_SENTINEL);
    expect(loggerMocks.fatal).toHaveBeenCalledWith(
      expect.stringContaining('missing-device')
    );
    expect(exitSpy).toHaveBeenCalled();
  });
});
