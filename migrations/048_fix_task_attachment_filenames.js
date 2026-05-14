const { model } = require("mongoose");

// Set DRY_RUN=true in env to preview changes without writing to DB
const DRY_RUN = process.env.DRY_RUN === "true";

// Regex matching generic fallback names the frontend generated: file_0, file_1, file_10, etc.
const GENERIC_NAME_PATTERN = /^file_\d+$/;

// S3 filename prefix pattern: files-{13-digit-timestamp}-{original}
const S3_PREFIX_PATTERN = /^files-\d{13}-(.+)$/;

/**
 * Reconstruct a meaningful filename from the stored URL/path.
 * Returns null if reconstruction is not possible or the URL is not a local path.
 */
const extractFileNameFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;

  try {
    let pathname = url;

    // Handle full https:// URLs — extract pathname only
    if (url.startsWith("http://") || url.startsWith("https://")) {
      pathname = new URL(url).pathname;
    }

    // Get the last segment of the path
    const segment = pathname.split("/").pop();
    if (!segment) return null;

    // Strip the files-{timestamp}- prefix if present (S3 upload pattern)
    const s3Match = segment.match(S3_PREFIX_PATTERN);
    if (s3Match) {
      return decodeURIComponent(s3Match[1]); // e.g. "boarddd_issue_11.mp4"
    }

    // Legacy disk pattern: file-{timestamp}.ext — no original name embedded, use as-is
    return decodeURIComponent(segment);
  } catch (_) {
    return null;
  }
};

module.exports = {
  name: "048_fix_task_attachment_filenames",
  version: "1.0.0",
  description:
    "Fix task attachment fileNames that were stored as generic placeholders (file_0, file_1, …) by reconstructing the name from the stored URL",

  async up() {
    try {
      if (DRY_RUN) {
        console.log("🔍 DRY RUN MODE — no changes will be written");
      }
      console.log("🔄 Starting task attachment filename fix migration...");

      const TaskModel = model("Task");

      // Find all tasks that have at least one attachment with a generic file_N name
      const affectedTasks = await TaskModel.find({
        attachments: {
          $elemMatch: { fileName: GENERIC_NAME_PATTERN },
        },
      }).lean();

      if (affectedTasks.length === 0) {
        console.log("ℹ️  No tasks found with generic attachment filenames");
        return { success: true, message: "No tasks required fixing" };
      }

      console.log(`📊 Found ${affectedTasks.length} tasks with generic attachment filenames`);

      let totalAttachmentsFixed = 0;
      let totalTasksUpdated = 0;
      const BATCH_SIZE = 500;
      const bulkOps = [];

      for (const task of affectedTasks) {
        let taskModified = false;

        const updatedAttachments = task.attachments.map((attachment) => {
          // Only fix attachments with generic file_N names
          if (!GENERIC_NAME_PATTERN.test(attachment.fileName)) {
            return attachment;
          }

          // Skip cloud-sourced files — they don't have local URLs
          if (attachment.source && attachment.source !== "local") {
            return attachment;
          }

          const reconstructed = extractFileNameFromUrl(attachment.url);
          if (!reconstructed) {
            console.warn(
              `  ⚠️  Could not reconstruct filename for task ${task._id}, url: ${attachment.url}`
            );
            return attachment;
          }

          if (DRY_RUN) {
            console.log(
              `  [DRY RUN] Task ${task._id}: "${attachment.fileName}" → "${reconstructed}"`
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

          // Flush batch
          if (bulkOps.length >= BATCH_SIZE) {
            if (!DRY_RUN) {
              await TaskModel.bulkWrite(bulkOps);
            }
            console.log(`  ✅ Flushed batch of ${bulkOps.length} updates`);
            bulkOps.length = 0;
          }
        }
      }

      // Flush remaining ops
      if (bulkOps.length > 0) {
        if (!DRY_RUN) {
          await TaskModel.bulkWrite(bulkOps);
        }
        console.log(`  ✅ Flushed final batch of ${bulkOps.length} updates`);
      }

      const summary = DRY_RUN
        ? `DRY RUN complete — would have fixed ${totalAttachmentsFixed} attachments across ${totalTasksUpdated} tasks`
        : `Fixed ${totalAttachmentsFixed} attachments across ${totalTasksUpdated} tasks`;

      console.log(`🎉 Migration complete: ${summary}`);
      return {
        success: true,
        message: summary,
        tasksUpdated: totalTasksUpdated,
        attachmentsFixed: totalAttachmentsFixed,
      };
    } catch (error) {
      console.error("❌ Migration failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    // The original "file_0", "file_1" values were not stored before overwriting,
    // so there is no way to restore them. This migration is intentionally irreversible.
    console.log(
      "ℹ️  048_fix_task_attachment_filenames: down() is a no-op — original generic names (file_0 etc.) cannot be restored"
    );
    return { success: true, message: "No rollback possible — no-op" };
  },
};
