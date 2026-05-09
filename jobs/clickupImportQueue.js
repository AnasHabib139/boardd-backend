"use strict";

const { Queue } = require("bullmq");
const { getRedis } = require("../utils/redis");

let _queue = null;

const getImportQueue = () => {
  if (!_queue) {
    _queue = new Queue("clickup-import", {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1,        // don't retry failed imports automatically
        removeOnComplete: { age: 3600 },  // keep completed jobs 1 hour
        removeOnFail:     { age: 86400 }, // keep failed jobs 24 hours
      },
    });
  }
  return _queue;
};

module.exports = { getImportQueue };
