"use strict";

const { Queue }        = require("bullmq");
const { getBullRedis } = require("../utils/redis");

let _queue = null;

const getGithubImportQueue = () => {
  if (!_queue) {
    _queue = new Queue("github-import", {
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

module.exports = { getGithubImportQueue };
