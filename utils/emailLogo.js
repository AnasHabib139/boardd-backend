const fs = require("fs");
const path = require("path");
const logoBytes = fs.readFileSync(
  path.join(__dirname, "../assets/images/boardd-logo.png")
);
exports.LOGO_DATA_URI = `data:image/png;base64,${logoBytes.toString("base64")}`;
