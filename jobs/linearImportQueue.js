"use strict";

const { Queue }        = require("bullmq");
const { getBullRedis } = require("../utils/redis");
const { STANDARD_QUEUE_JOB_OPTIONS } = require("./helpers/importWorkerShared");

let _queue = null;

const getLinearImportQueue = () => {
  if (!_queue) {
    _queue = new Queue("linear-import", {
      connection: getBullRedis(),
      defaultJobOptions: STANDARD_QUEUE_JOB_OPTIONS,
    });
  }
  return _queue;
};

module.exports = { getLinearImportQueue };
