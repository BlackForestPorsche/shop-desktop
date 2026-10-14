import { readFile, mkdir, writeFile } from "node:fs/promises";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createRoPrintStore(filePath) {
  let cache = null;

  async function load() {
    if (cache) return cache;
    try {
      const text = await readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      cache = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      cache = {};
    }
    return cache;
  }

  async function save() {
    await mkdir(filePath.replace(/[^/]+$/, ""), { recursive: true }).catch(() => {});
    const dir = filePath.slice(0, filePath.lastIndexOf("/"));
    if (dir) await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(cache || {}, null, 2));
  }

  async function prune() {
    const data = await load();
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of Object.entries(data)) {
      const at = Number(entry?.at || 0);
      if (!at || now - at > DAY_MS) {
        delete data[key];
        changed = true;
      }
    }
    if (changed) await save();
    return data;
  }

  return {
    async has(roNumber) {
      const key = String(roNumber || "").trim();
      if (!key) return false;
      const data = await prune();
      return Boolean(data[key]);
    },
    async mark(roNumber, meta = {}) {
      const key = String(roNumber || "").trim();
      if (!key) return;
      const data = await prune();
      data[key] = { at: Date.now(), ...meta };
      await save();
    },
  };
}
