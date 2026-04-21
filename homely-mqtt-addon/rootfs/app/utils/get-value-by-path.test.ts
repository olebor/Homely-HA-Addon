import { describe, expect, it } from 'vitest';
import { getValueByPath } from './get-value-by-path';

describe('getValueByPath', () => {
  it('returns single-level values', () => {
    const obj = { name: 'Kitchen' };
    expect(getValueByPath(obj, 'name')).toBe('Kitchen');
  });

  it('returns deep-nested values', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getValueByPath(obj, 'a.b.c')).toBe(42);
  });

  it('returns undefined for a missing leaf', () => {
    const obj = { a: { b: { c: 1 } } };
    expect(getValueByPath(obj as unknown as { a: { b: { d: number } } }, 'a.b.d')).toBeUndefined();
  });

  it('returns undefined for a missing intermediate segment without throwing', () => {
    const obj = { a: 1 } as Record<string, unknown>;
    expect(() => getValueByPath(obj, 'a.b.c')).not.toThrow();
    expect(getValueByPath(obj, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined when the first segment is missing', () => {
    const obj = { a: 1 } as Record<string, unknown>;
    expect(getValueByPath(obj, 'missing')).toBeUndefined();
  });

  it('preserves falsy-but-defined values (false, 0, "")', () => {
    expect(getValueByPath({ a: { b: false } }, 'a.b')).toBe(false);
    expect(getValueByPath({ a: { b: 0 } }, 'a.b')).toBe(0);
    expect(getValueByPath({ a: { b: '' } }, 'a.b')).toBe('');
  });
});
