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

// ─── Notion Page PDF ──────────────────────────────────────────────────────────

// Strip emoji and symbols outside the Latin-1 range — pdfkit's built-in
// Helvetica/Courier fonts only cover Basic Latin + Latin-1 Supplement.
const stripUnsupportedChars = (text) =>
  text.replace(/[^ -ÿ]/g, "").replace(/\s+/g, " ").trim();

const stripInlineMarkers = (text) => {
  const cleaned = text
    .replace(/!\[.*?\]\(.*?\)/g, "")           // remove images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // [label](url) → label
    .replace(/\*\*(.+?)\*\*/g, "$1")            // **bold** → text
    .replace(/__(.+?)__/g, "$1")                // __bold__ → text
    .replace(/\*(.+?)\*/g, "$1")                // *italic* → text
    .replace(/_(.+?)_/g, "$1")                  // _italic_ → text
    .replace(/`(.+?)`/g, "$1");                 // `code` → text
  return stripUnsupportedChars(cleaned);
};

const parseMarkdownBlocks = (md) => {
  const lines   = (md || "").split("\n");
  const blocks  = [];
  let inCode    = false;
  let codeLines = [];

  for (const raw of lines) {
    const line = raw;

    if (inCode) {
      if (/^```/.test(line)) {
        blocks.push({ type: "code_block", text: codeLines.join("\n") });
        codeLines = [];
        inCode    = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/.test(line))          { inCode = true; continue; }
    if (/^### /.test(line))         { blocks.push({ type: "h3",         text: stripInlineMarkers(line.slice(4)) }); continue; }
    if (/^## /.test(line))          { blocks.push({ type: "h2",         text: stripInlineMarkers(line.slice(3)) }); continue; }
    if (/^# /.test(line))           { blocks.push({ type: "h1",         text: stripInlineMarkers(line.slice(2)) }); continue; }
    if (/^> /.test(line))           { blocks.push({ type: "blockquote", text: stripInlineMarkers(line.slice(2)) }); continue; }
    if (/^[-*] /.test(line))        { blocks.push({ type: "bullet",     text: stripInlineMarkers(line.slice(2)) }); continue; }
    if (/^\d+\. /.test(line)) {
      const m = line.match(/^(\d+)\. (.*)/);
      blocks.push({ type: "numbered", text: stripInlineMarkers(m[2]), number: parseInt(m[1], 10) });
      continue;
    }
    if (/^---$/.test(line.trim()))  { blocks.push({ type: "rule" }); continue; }
    if (line.trim() === "")         { blocks.push({ type: "empty" }); continue; }
    blocks.push({ type: "paragraph", text: stripInlineMarkers(line) });
  }

  if (inCode && codeLines.length) blocks.push({ type: "code_block", text: codeLines.join("\n") });
  return blocks;
};

const PAGE_W        = 595.28;
const PAGE_H        = 841.89;
const MARGIN        = 50;
const CONTENT_W     = PAGE_W - MARGIN * 2;   // 495.28
const BREAK_THRESH  = PAGE_H - MARGIN - 60;  // 731.89
const FOOTER_Y      = PAGE_H - 30;           // 811.89

exports.generateNotionPagePdf = (pageTitle, markdownContent, importedAt) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on("data",  (c) => chunks.push(c));
    doc.on("error", reject);

    // ── Header (first page only) ─────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#1a1a1a")
       .text(pageTitle || "Untitled", MARGIN, MARGIN, { width: CONTENT_W });
    let currentY = MARGIN + doc.heightOfString(pageTitle || "Untitled", { width: CONTENT_W, fontSize: 22 }) + 6;

    const dateStr = (importedAt || new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    doc.font("Helvetica").fontSize(9).fillColor("#888888")
       .text(`Imported from Notion • ${dateStr}`, MARGIN, currentY, { width: CONTENT_W });
    currentY += doc.heightOfString(`Imported from Notion • ${dateStr}`, { width: CONTENT_W, fontSize: 9 }) + 8;

    doc.moveTo(MARGIN, currentY).lineTo(MARGIN + CONTENT_W, currentY)
       .lineWidth(1).strokeColor("#6C63FF").stroke();
    currentY += 20;

    // ── Block rendering ───────────────────────────────────────────────────────
    const ensurePage = (needed) => {
      if (currentY + needed > BREAK_THRESH) {
        doc.addPage();
        currentY = MARGIN;
      }
    };

    for (const block of parseMarkdownBlocks(markdownContent)) {
      switch (block.type) {

        case "empty":
          currentY += 6;
          break;

        case "rule":
          ensurePage(20);
          currentY += 8;
          doc.moveTo(MARGIN, currentY).lineTo(MARGIN + CONTENT_W, currentY)
             .lineWidth(0.5).strokeColor("#CCCCCC").stroke();
          currentY += 10;
          break;

        case "h1": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W, fontSize: 20 });
          ensurePage(14 + h);
          currentY += 14;
          doc.font("Helvetica-Bold").fontSize(20).fillColor("#1a1a1a")
             .text(block.text, MARGIN, currentY, { width: CONTENT_W });
          currentY += h + 4;
          break;
        }
        case "h2": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W, fontSize: 16 });
          ensurePage(12 + h);
          currentY += 12;
          doc.font("Helvetica-Bold").fontSize(16).fillColor("#1a1a1a")
             .text(block.text, MARGIN, currentY, { width: CONTENT_W });
          currentY += h + 4;
          break;
        }
        case "h3": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W, fontSize: 13 });
          ensurePage(10 + h);
          currentY += 10;
          doc.font("Helvetica-Bold").fontSize(13).fillColor("#444444")
             .text(block.text, MARGIN, currentY, { width: CONTENT_W });
          currentY += h + 3;
          break;
        }

        case "paragraph": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W, fontSize: 11 });
          ensurePage(6 + h);
          currentY += 6;
          doc.font("Helvetica").fontSize(11).fillColor("#333333")
             .text(block.text, MARGIN, currentY, { width: CONTENT_W });
          currentY += h;
          break;
        }

        case "bullet": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W - 25, fontSize: 11 });
          ensurePage(4 + h);
          currentY += 4;
          doc.font("Helvetica").fontSize(11).fillColor("#333333")
             .text("•", MARGIN + 5, currentY)
             .text(block.text, MARGIN + 20, currentY, { width: CONTENT_W - 25 });
          currentY += h;
          break;
        }

        case "numbered": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W - 25, fontSize: 11 });
          ensurePage(4 + h);
          currentY += 4;
          doc.font("Helvetica").fontSize(11).fillColor("#333333")
             .text(`${block.number}.`, MARGIN + 5, currentY)
             .text(block.text, MARGIN + 25, currentY, { width: CONTENT_W - 30 });
          currentY += h;
          break;
        }

        case "blockquote": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W - 18, fontSize: 11 });
          ensurePage(8 + h + 8);
          currentY += 8;
          doc.rect(MARGIN, currentY, 3, h + 8).fill("#6C63FF");
          doc.font("Helvetica").fontSize(11).fillColor("#666666")
             .text(block.text, MARGIN + 14, currentY + 4, { width: CONTENT_W - 18 });
          currentY += h + 12;
          break;
        }

        case "code_block": {
          const h = doc.heightOfString(block.text, { width: CONTENT_W - 18, fontSize: 9 });
          ensurePage(8 + h + 16);
          currentY += 8;
          doc.rect(MARGIN, currentY, CONTENT_W, h + 16).fill("#f5f5f5");
          doc.font("Courier").fontSize(9).fillColor("#444444")
             .text(block.text, MARGIN + 9, currentY + 8, { width: CONTENT_W - 18 });
          currentY += h + 20;
          break;
        }
      }
    }

    // ── Footer on every page ─────────────────────────────────────────────────
    doc.end();

    doc.on("end", () => {
      const range = doc.bufferedPageRange();
      const total = range.count;
      for (let i = 0; i < total; i++) {
        doc.switchToPage(range.start + i);
        doc.font("Helvetica").fontSize(8).fillColor("#999999")
           .text("Boardd", MARGIN, FOOTER_Y, { width: CONTENT_W, align: "left",  lineBreak: false })
           .text(`Page ${i + 1} of ${total}`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "right", lineBreak: false });
      }
      resolve(Buffer.concat(chunks));
    });
  });
};
