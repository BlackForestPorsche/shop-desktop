"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dest = path.join(root, "assets", "icon.png");
const sourceUrl =
  process.env.BLACKFOREST_ICON_URL ||
  "https://shop.blackforestautomotive.com/__grok/icon-180.png";

function download(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        download(response.headers.location).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        response.resume();
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function main() {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = await download(sourceUrl);
  if (!body.length || body[0] !== 0x89) {
    throw new Error("Downloaded icon is not a PNG");
  }
  fs.writeFileSync(dest, body);
  console.log(`Wrote ${dest} (${body.length} bytes)`);
}

main().catch((error) => {
  console.error(`ensure-icon: ${error.message}`);
  process.exit(1);
});
