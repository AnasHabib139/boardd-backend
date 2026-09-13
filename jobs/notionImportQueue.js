"use strict";

const { Queue }        = require("bullmq");
const { getBullRedis } = require("../utils/redis");
const { STANDARD_QUEUE_JOB_OPTIONS } = require("./helpers/importWorkerShared");

let _queue = null;

const getNotionImportQueue = () => {
  if (!_queue) {
    _queue = new Queue("notion-import", {
      connection: getBullRedis(),
      defaultJobOptions: STANDARD_QUEUE_JOB_OPTIONS,
    });
  }
  return _queue;
};

module.exports = { getNotionImportQueue };
