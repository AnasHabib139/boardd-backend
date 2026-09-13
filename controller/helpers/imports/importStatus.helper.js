"use strict";

const { generateResponse } = require("../../../utils");
const { STATUS_CODES } = require("../../../utils/constants");
const { findImportJob } = require("../../../models/importJobModel");

exports.getImportStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await findImportJob({ _id: jobId, userId: req.user.id });
    if (!job) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Import job not found" });
    return generateResponse(job, "Import status", res);
  } catch (error) {
    return next(error);
  }
};
