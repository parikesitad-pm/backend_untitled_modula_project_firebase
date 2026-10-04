import { admin } from '../config/firebase';

export interface Clock {
  now(): Date;
  nowMillis(): number;
  nowIso(): string;
  nowTimestamp(): admin.firestore.Timestamp;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMillis(): number {
    return Date.now();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  nowTimestamp(): admin.firestore.Timestamp {
    return admin.firestore.Timestamp.now();
  }
}

export class MockClock implements Clock {
  private currentTime: Date;

  constructor(initialDate: Date | string = new Date()) {
    this.currentTime = new Date(initialDate);
  }

  setTime(date: Date | string): void {
    this.currentTime = new Date(date);
  }

  advanceByMs(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  advanceSeconds(sec: number): void {
    this.advanceByMs(sec * 1000);
  }

  advanceMinutes(min: number): void {
    this.advanceByMs(min * 60 * 1000);
  }

  advanceHours(hours: number): void {
    this.advanceByMs(hours * 3600 * 1000);
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  nowMillis(): number {
    return this.currentTime.getTime();
  }

  nowIso(): string {
    return this.currentTime.toISOString();
  }

  nowTimestamp(): admin.firestore.Timestamp {
    return admin.firestore.Timestamp.fromDate(this.currentTime);
  }
}

let activeClock: Clock = new SystemClock();

export function getClock(): Clock {
  return activeClock;
}

export function setSystemClock(clock: Clock | null): void {
  activeClock = clock || new SystemClock();
}
