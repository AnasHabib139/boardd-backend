"use strict";

class RateLimiter {
  constructor(maxPerMinute = 95) {
    this.max = maxPerMinute;
    this.calls = 0;
    this.windowStart = Date.now();
  }

  async throttle() {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    if (elapsed >= 60_000) {
      // New window
      this.calls = 0;
      this.windowStart = now;
    }

    if (this.calls >= this.max) {
      // Sleep until the current window expires
      const sleepMs = 60_000 - elapsed + 100; // +100ms buffer
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      this.calls = 0;
      this.windowStart = Date.now();
    }

    this.calls++;
  }
}

module.exports = RateLimiter;
