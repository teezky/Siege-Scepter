/** Injectable clock so time-based logic is testable (project instructions section 27). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date()
};

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(date: Date): void {
    this.current = date;
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
