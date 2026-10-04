import { describe, it, expect, beforeEach } from 'vitest';
import { MockClock, SystemClock, setSystemClock, getClock } from '../../src/lib/clock';

describe('Clock Provider', () => {
  beforeEach(() => {
    setSystemClock(new SystemClock());
  });

  it('provides real time via SystemClock', () => {
    const clock = new SystemClock();
    const now = clock.now();
    expect(now).toBeInstanceOf(Date);
    expect(clock.nowMillis()).toBeCloseTo(Date.now(), -3);
    expect(clock.nowIso()).toContain('Z');
  });

  it('allows mocking and advancing time via MockClock', () => {
    const mock = new MockClock('2026-10-01T12:00:00Z');
    setSystemClock(mock);

    expect(getClock().nowIso()).toBe('2026-10-01T12:00:00.000Z');

    mock.advanceMinutes(30);
    expect(getClock().nowIso()).toBe('2026-10-01T12:30:00.000Z');

    mock.advanceSeconds(45);
    expect(getClock().nowIso()).toBe('2026-10-01T12:30:45.000Z');

    mock.advanceHours(2);
    expect(getClock().nowIso()).toBe('2026-10-01T14:30:45.000Z');
  });
});
