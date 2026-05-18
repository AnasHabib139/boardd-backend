"use strict";

const { Queue }        = require("bullmq");
const { getBullRedis } = require("../utils/redis");

let _queue = null;

const getAsanaImportQueue = () => {
  if (!_queue) {
    _queue = new Queue("asana-import", {
      connection: getBullRedis(),
      defaultJobOptions: {
        attempts:         1,
        removeOnComplete: { age: 3600 },
        removeOnFail:     { age: 86400 },
      },
    });
  }
  return _queue;
};

module.exports = { getAsanaImportQueue };
