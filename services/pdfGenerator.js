"use strict";

const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

/**
 * Generate Clockup Report PDF
 * @param {Array} entries - Time entries with children
 * @param {Object} userInfo - User information {userId, name, email, image}
 * @param {String} startDate - Report start date
 * @param {String} endDate - Report end date
 * @param {String} weekTotal - Total duration formatted as HH:MM:SS
 * @param {Object} options - Optional settings {totalLabel: 'ENTRY TOTAL', isSingleEntry: true}
 * @returns {Promise<Buffer>} PDF buffer
 */
exports.generateClockupReportPDF = async (entries, userInfo, startDate, endDate, weekTotal, options = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Create PDF document
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Clockup Report - ${userInfo.name}`,
          Author: "Boardd Clockup",
          Subject: `Timesheet Report ${startDate} to ${endDate}`,
        },
      });

      // Collect PDF chunks
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Get company info from first entry (all entries have same company)
      const companyName = entries[0]?.companyName || "Company";

      // Add user profile picture on the right (circular)
      if (userInfo.image) {
        try {
          const userImageUrl = getS3Url(userInfo.image);
          if (userImageUrl) {
            const userImageBuffer = await downloadImage(userImageUrl);
            const imageSize = 60; // diameter
            const imageX = 545 - imageSize; // Right aligned (545 is page width - margin)
            const imageY = 50;

            // Draw circular profile picture
            doc.save();
            doc.circle(imageX + imageSize / 2, imageY + imageSize / 2, imageSize / 2).clip();
            doc.image(userImageBuffer, imageX, imageY, {
              width: imageSize,
              height: imageSize,
              fit: [imageSize, imageSize]
            });
            doc.restore();
          }
        } catch (error) {
          console.warn("Failed to load user profile image:", error.message);
          // Continue without user image
        }
      }

      // Header - Company Name (centered)
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(companyName, 50, 50, { align: "center" });

      // Report Title
      doc
        .fontSize(16)
        .font("Helvetica")
        .text("TIMESHEET REPORT", 50, 75, { align: "center" });

      // Move down after header
      doc.moveDown(2);

      // User Information Section
      const userInfoY = doc.y;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Employee: ", 50, userInfoY, { continued: true })
        .font("Helvetica")
        .text(`${userInfo.name} (${userInfo.email})`);

      doc
        .font("Helvetica-Bold")
        .text("Report Period: ", 50, doc.y + 5, { continued: true })
        .font("Helvetica")
        .text(`${formatDate(startDate)} - ${formatDate(endDate)}`);

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#666666")
        .text(`Generated: ${new Date().toLocaleString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}`, 50, doc.y + 5);

      doc.fillColor("#000000");

      // Draw separator line
      doc
        .moveDown(1)
        .strokeColor("#CCCCCC")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(1);

      // Group entries by date
      const entriesByDate = groupByDate(entries);

      // Render entries by date
      for (const [date, dateEntries] of Object.entries(entriesByDate)) {
        // Check if we need a new page
        if (doc.y > 700) {
          doc.addPage();
        }

        // Date Header
        doc
          .fontSize(13)
          .font("Helvetica-Bold")
          .text(date, 50, doc.y);

        // Date underline
        const dateY = doc.y;
        doc
          .strokeColor("#333333")
          .lineWidth(0.5)
          .moveTo(50, dateY)
          .lineTo(545, dateY)
          .stroke();

        doc.moveDown(0.5);

        // Render each parent entry
        for (const entry of dateEntries) {
          // Check if we need a new page
          if (doc.y > 680) {
            doc.addPage();
          }

          // Parent Entry
          const entryY = doc.y;

          // Title and Duration on same line
          doc
            .fontSize(11)
            .font("Helvetica-Bold")
            .text(entry.title || "Time Entry", 50, entryY, { width: 400, continued: false });

          doc
            .fontSize(11)
            .font("Helvetica-Bold")
            .text(entry.duration, 500, entryY, { width: 80, align: "right" });

          // Description
          if (entry.description) {
            doc
              .fontSize(10)
              .font("Helvetica")
              .fillColor("#444444")
              .text(entry.description, 50, doc.y, { width: 495 });
          }

          // Time range
          doc
            .fontSize(9)
            .fillColor("#666666")
            .text(`${entry.startTime} - ${entry.endTime}`, 50, doc.y + 2);

          doc.fillColor("#000000");
          doc.moveDown(0.3);

          // Render children entries
          if (entry.children && entry.children.length > 0) {
            for (const child of entry.children) {
              // Check if we need a new page
              if (doc.y > 700) {
                doc.addPage();
              }

              const childY = doc.y;

              // Child indicator and title
              doc
                .fontSize(10)
                .font("Helvetica")
                .fillColor("#666666")
                .text("> ", 70, childY, { continued: true })
                .fillColor("#000000")
                .text(child.title || "Continued Work", { width: 350, continued: false });

              // Child duration
              doc
                .fontSize(10)
                .font("Helvetica")
                .text(child.duration, 500, childY, { width: 80, align: "right" });

              // Child description
              if (child.description) {
                doc
                  .fontSize(9)
                  .fillColor("#555555")
                  .text(child.description, 85, doc.y, { width: 410 });
              }

              // Child time range
              doc
                .fontSize(8)
                .fillColor("#888888")
                .text(`${child.startTime} - ${child.endTime}`, 85, doc.y + 2);

              doc.fillColor("#000000");
              doc.moveDown(0.3);
            }
          }

          doc.moveDown(0.5);
        }

        doc.moveDown(1);
      }

      // Check if we need space for footer
      if (doc.y > 700) {
        doc.addPage();
      }

      // Draw separator line before total
      doc
        .strokeColor("#333333")
        .lineWidth(1.5)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(0.5);

      // Total Hours (label can be customized via options)
      const totalLabel = options.totalLabel || "TOTAL HOURS:";
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(totalLabel, 50, doc.y, { continued: true })
        .text(weekTotal, { align: "right" });

      doc.moveDown(2);

      // Footer
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#999999")
        .text("This report was generated by Boarddd Clockup", 50, doc.y, { align: "center" });

      // Page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .fillColor("#999999")
          .text(
            `Page ${i + 1} of ${pages.count}`,
            50,
            doc.page.height - 50,
            { align: "center" }
          );
      }

      // Finalize PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Download image from URL
 * @param {String} url - Image URL
 * @returns {Promise<Buffer>} Image buffer
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Group entries by date
 * @param {Array} entries - Time entries
 * @returns {Object} Entries grouped by date
 */
function groupByDate(entries) {
  const grouped = {};

  for (const entry of entries) {
    const date = entry.date;
    if (!grouped[date]) {
      grouped[date] = [];
    }
    grouped[date].push(entry);
  }

  return grouped;
}

/**
 * Format date string
 * @param {String} dateStr - Date string (YYYY-MM-DD)
 * @returns {String} Formatted date (Month DD, YYYY)
 */
function formatDate(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Convert S3 path to full URL
 * @param {String} s3Path - S3 path like /uploadFiles/images/file.png
 * @returns {String} Full S3 URL or null
 */
function getS3Url(s3Path) {
  if (!s3Path) return null;

  // If already a full URL, return as-is
  if (s3Path.startsWith("http://") || s3Path.startsWith("https://")) {
    return s3Path;
  }

  // Remove leading slash if present
  const cleanPath = s3Path.startsWith("/") ? s3Path.substring(1) : s3Path;

  // Construct full S3 URL
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION;

  return `https://${bucket}.s3.${region}.amazonaws.com/${cleanPath}`;
}
