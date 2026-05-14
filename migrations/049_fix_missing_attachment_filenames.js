const { model } = require("mongoose");

// Set DRY_RUN=true in env to preview changes without writing to DB
const DRY_RUN = process.env.DRY_RUN === "true";

// S3 filename prefix: files-{13-digit-timestamp}-{sanitized-original-name}
const S3_PREFIX_PATTERN = /^files-\d{13}-(.+)$/;

/**
 * Reconstruct a meaningful filename from the stored URL/path.
 * Returns null if the URL is missing or unparseable.
 */
const extractFileNameFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;

  try {
    let pathname = url;

    // Handle full https:// URLs — extract pathname only
    if (url.startsWith("http://") || url.startsWith("https://")) {
      pathname = new URL(url).pathname;
    }

    // Get the last path segment
    const segment = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
    if (!segment) return null;

    // Strip the files-{timestamp}- prefix if present (new S3 upload pattern)
    // e.g. files-1772454757233-Create_Forms.mp4 → Create_Forms.mp4
    const s3Match = segment.match(S3_PREFIX_PATTERN);
    if (s3Match) return s3Match[1];

    // Legacy disk pattern (file-{timestamp}.ext) — no original name embedded, use full segment
    return segment;
  } catch (_) {
    return null;
  }
};

/** Returns true for any fileName value that should be reconstructed */
const needsFixing = (fileName) =>
  fileName === null ||
  fileName === undefined ||
  (typeof fileName === "string" && fileName.trim() === "") ||
  /^file_\d+$/.test(fileName);

module.exports = {
  name: "049_fix_missing_attachment_filenames",
  version: "1.0.0",
  description:
    "Backfill fileName on task attachments that are null, empty, or generic (file_0 / file_1 …) by extracting the name from the stored URL",

  async up() {
    try {
      if (DRY_RUN) {
        console.log("🔍 DRY RUN MODE — no changes will be written");
      }
      console.log("🔄 Starting missing attachment filename backfill...");

      const TaskModel = model("Task");

      // Find tasks that have at least one local attachment with a missing/empty/generic fileName
      const affectedTasks = await TaskModel.find({
        attachments: {
          $elemMatch: {
            source: { $in: ["local", null, undefined] },
            $or: [
              { fileName: { $exists: false } },
              { fileName: null },
              { fileName: "" },
              { fileName: /^file_\d+$/ },
            ],
          },
        },
      }).lean();

      if (affectedTasks.length === 0) {
        console.log("ℹ️  No tasks found with missing or generic attachment filenames");
        return { success: true, message: "No tasks required fixing" };
      }

      console.log(`📊 Found ${affectedTasks.length} tasks to process`);

      let totalAttachmentsFixed = 0;
      let totalAttachmentsSkipped = 0;
      let totalTasksUpdated = 0;
      const BATCH_SIZE = 500;
      const bulkOps = [];

      for (const task of affectedTasks) {
        let taskModified = false;

        const updatedAttachments = task.attachments.map((attachment) => {
          // Skip attachments that already have a proper fileName
          if (!needsFixing(attachment.fileName)) return attachment;

          // Skip cloud-sourced files — their display name comes from webViewLink, not URL
          if (attachment.source && attachment.source !== "local") return attachment;

          const reconstructed = extractFileNameFromUrl(attachment.url);

          if (!reconstructed) {
            console.warn(
              `  ⚠️  Could not reconstruct filename for task ${task._id}, url: ${attachment.url}`
            );
            totalAttachmentsSkipped++;
            return attachment;
          }

          if (DRY_RUN) {
            console.log(
              `  [DRY RUN] Task ${task._id}: "${attachment.fileName ?? "(missing)"}" → "${reconstructed}"`
            );
          }

          taskModified = true;
          totalAttachmentsFixed++;
          return { ...attachment, fileName: reconstructed };
        });

        if (taskModified) {
          totalTasksUpdated++;
          bulkOps.push({
            updateOne: {
              filter: { _id: task._id },
              update: { $set: { attachments: updatedAttachments } },
            },
          });

          if (bulkOps.length >= BATCH_SIZE) {
            if (!DRY_RUN) await TaskModel.bulkWrite(bulkOps);
            console.log(`  ✅ Flushed batch of ${bulkOps.length} updates`);
            bulkOps.length = 0;
          }
        }
      }

      // Flush remaining
      if (bulkOps.length > 0) {
        if (!DRY_RUN) await TaskModel.bulkWrite(bulkOps);
        console.log(`  ✅ Flushed final batch of ${bulkOps.length} updates`);
      }

      const verb = DRY_RUN ? "Would fix" : "Fixed";
      const summary = `${verb} ${totalAttachmentsFixed} attachments across ${totalTasksUpdated} tasks (${totalAttachmentsSkipped} skipped — URL unparseable)`;
      console.log(`🎉 ${summary}`);

      return {
        success: true,
        message: summary,
        tasksUpdated: totalTasksUpdated,
        attachmentsFixed: totalAttachmentsFixed,
        attachmentsSkipped: totalAttachmentsSkipped,
      };
    } catch (error) {
      console.error("❌ Migration failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    // Original fileNames were not stored before overwriting — cannot restore.
    console.log(
      "ℹ️  049_fix_missing_attachment_filenames: down() is a no-op — original missing values cannot be restored"
    );
    return { success: true, message: "No rollback possible — no-op" };
  },
};
