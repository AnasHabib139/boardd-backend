"use strict";

const { createImportJob } = require("../../../models/importJobModel");

// Creates a pending ImportJob and enqueues it on the caller's already-resolved
// BullMQ queue instance. Returns { jobId }.
exports.createAndEnqueueImportJob = async ({ platform, queue, userId, companyId, payload }) => {
  const job = await createImportJob({ userId, platform, status: "pending" });

  await queue.add("import", {
    jobId: job._id.toString(),
    userId: userId.toString(),
    companyId: companyId.toString(),
    ...payload,
  });

  return { jobId: job._id };
};
