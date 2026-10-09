"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.join(__dirname, "..");
const dest = path.join(root, "assets", "icon.png");
const sourceUrl =
  process.env.BLACKFOREST_ICON_URL ||
  "https://shop.blackforestautomotive.com/__grok/icon-180.png";

const MIN_EDGE = 256;
const TARGET_EDGE = 512;

function pngSize(buf) {
  if (!buf || buf.length < 24 || buf[0] !== 0x89) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(buf) {
  if (!buf || buf.length < 8 || buf[0] !== 0x89) {
    throw new Error("Not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format depth=${bitDepth} type=${colorType}`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bytesPerPixel = inflated.length === height * (1 + width * 4) ? 4 : 3;
  const stride = 1 + width * bytesPerPixel;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(width * bytesPerPixel);

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const filter = inflated[rowStart];
    const raw = inflated.subarray(rowStart + 1, rowStart + stride);
    const recon = Buffer.alloc(width * bytesPerPixel);

    for (let i = 0; i < raw.length; i++) {
      const left = i >= bytesPerPixel ? recon[i - bytesPerPixel] : 0;
      const up = prev[i];
      const upLeft = i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0;
      let value = raw[i];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      recon[i] = value;
    }

    for (let x = 0; x < width; x++) {
      const src = x * bytesPerPixel;
      const dst = (y * width + x) * 4;
      rgba[dst] = recon[src];
      rgba[dst + 1] = recon[src + 1];
      rgba[dst + 2] = recon[src + 2];
      rgba[dst + 3] = bytesPerPixel === 4 ? recon[src + 3] : 255;
    }
    prev = recon;
  }

  return { width, height, rgba };
}

function encodePngRgba(width, height, rgba) {
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function upscaleNearest(buf, targetEdge) {
  const { width, height, rgba } = decodePngRgba(buf);
  const out = Buffer.alloc(targetEdge * targetEdge * 4);
  for (let y = 0; y < targetEdge; y++) {
    const srcY = Math.min(height - 1, Math.floor((y * height) / targetEdge));
    for (let x = 0; x < targetEdge; x++) {
      const srcX = Math.min(width - 1, Math.floor((x * width) / targetEdge));
      const src = (srcY * width + srcX) * 4;
      const dst = (y * targetEdge + x) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return encodePngRgba(targetEdge, targetEdge, out);
}

function tryPythonUpscale(srcPath, destPath) {
  const script = `
from PIL import Image
im = Image.open(${JSON.stringify(srcPath)}).convert("RGBA")
im.resize((${TARGET_EDGE}, ${TARGET_EDGE}), Image.Resampling.LANCZOS).save(${JSON.stringify(destPath)})
print("pillow-upscale", im.size)
`;
  for (const bin of ["python3", "python"]) {
    const result = spawnSync(bin, ["-c", script], { encoding: "utf8" });
    if (result.status === 0 && fs.existsSync(destPath)) {
      console.log(result.stdout.trim());
      return true;
    }
  }
  return false;
}

async function main() {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let body = null;
  if (fs.existsSync(dest)) {
    body = fs.readFileSync(dest);
    const size = pngSize(body);
    if (size && size.width >= MIN_EDGE && size.height >= MIN_EDGE) {
      console.log(`Using existing icon ${size.width}x${size.height}`);
      return;
    }
  }

  if (!body) {
    body = await download(sourceUrl);
  }

  const size = pngSize(body);
  if (!size) {
    throw new Error("Could not read PNG icon");
  }

  if (size.width >= MIN_EDGE && size.height >= MIN_EDGE) {
    fs.writeFileSync(dest, body);
    console.log(`Wrote ${dest} (${body.length} bytes, ${size.width}x${size.height})`);
    return;
  }

  const temp = path.join(root, "assets", ".icon-source.png");
  fs.writeFileSync(temp, body);

  if (tryPythonUpscale(temp, dest)) {
    fs.rmSync(temp, { force: true });
    const outSize = pngSize(fs.readFileSync(dest));
    console.log(
      `Upscaled shop icon ${size.width}x${size.height} -> ${outSize.width}x${outSize.height}`
    );
    return;
  }

  const upscaled = upscaleNearest(body, TARGET_EDGE);
  fs.writeFileSync(dest, upscaled);
  fs.rmSync(temp, { force: true });
  console.log(
    `Nearest-neighbor upscaled shop icon ${size.width}x${size.height} -> ${TARGET_EDGE}x${TARGET_EDGE}`
  );
}

main().catch((error) => {
  console.error(`ensure-icon: ${error.message}`);
  process.exit(1);
});
