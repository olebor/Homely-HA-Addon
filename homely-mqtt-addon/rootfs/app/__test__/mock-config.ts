import { vi } from 'vitest';
import { getValueByPath } from '../utils/get-value-by-path';

export type ConfigTree = {
  homely?: { host?: string };
  mqtt?: {
    host?: string;
    enabled?: boolean;
    user?: string;
    qos?: number;
    entityPrefix?: string;
    topicPrefixes?: { config?: string; state?: string };
  };
  database?: unknown;
  polling?: { schedule?: string };
  logLevel?: string;
};

const defaults: ConfigTree = {
  homely: { host: 'sdk.iotiliti.cloud' },
  mqtt: {
    host: 'mqtt://localhost:1883',
    enabled: false,
    topicPrefixes: { config: 'homeassistant', state: 'homely' },
  },
  logLevel: 'silent',
};

const merge = <T>(a: T, b: Partial<T>): T => {
  if (typeof a !== 'object' || a === null) return (b ?? a) as T;
  const out = { ...(a as object) } as Record<string, unknown>;
  for (const key of Object.keys(b as object)) {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    out[key] =
      av && bv && typeof av === 'object' && typeof bv === 'object'
        ? merge(av, bv as Partial<typeof av>)
        : bv;
  }
  return out as T;
};

export const buildConfigMock = (overrides: ConfigTree = {}) => {
  const tree = merge(defaults, overrides);
  const get = vi.fn((path: string) => {
    const value = getValueByPath(tree as Record<string, unknown>, path);
    if (value === undefined) {
      throw new Error(`ConfigMock: missing key "${path}"`);
    }
    return value;
  });
  return { default: { get }, get };
};
