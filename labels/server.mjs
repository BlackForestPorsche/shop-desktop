import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { describePrinter } from "./shared/detect.mjs";
import { sendPdfToQueue, sendToQueue } from "./shared/print.mjs";
import { safePageKey } from "./shared/media.mjs";
import { createRoPrintStore } from "./shared/ro-idempotency.mjs";
import { normalizeRoPayload, planRoPrint, renderRoLabelPdf, roLabelLines } from "./shared/ro-label.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const labelsFile = path.join(dataDir, "labels.json");
const roPrintsFile = path.join(dataDir, "ro-prints.json");
const roPrintStore = createRoPrintStore(roPrintsFile);
const port = Number(process.env.PORT || 8080);
const host = "0.0.0.0";

console.log(`Labels listening on ${host}:${port}`);
