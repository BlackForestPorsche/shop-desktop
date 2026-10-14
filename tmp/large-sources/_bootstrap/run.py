from pathlib import Path
import subprocess, os, sys, gzip, base64, hashlib, json
from collections import defaultdict

def run(cmd, check=True):
    print("+", " ".join(cmd))
    return subprocess.run(cmd, check=check)

branch = os.environ["GITHUB_REF_NAME"]
run(["git", "config", "user.name", "github-actions[bot]"])
run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"])

# --- stitch / unhex / decode WHILE we still have PR-branch large-sources ---
fixes_path = Path("tmp/large-sources/_byte_fixes.json")
if fixes_path.exists():
    for item in json.loads(fixes_path.read_text()):
        fp = Path(item["path"])
        if not fp.exists():
            continue
        text = fp.read_text()
        for rep in item.get("replacements", []):
            off = int(rep["offset"])
            old, new = rep["old"], rep["new"]
            if off < len(text) and text[off] == old:
                text = text[:off] + new + text[off + 1 :]
                print("byte_fix", fp, off, old, "->", new)
        fp.write_text(text)

root = Path("tmp/large-sources/_parts")
if root.exists():
    groups = defaultdict(list)
    for p in sorted(root.glob("*")):
        if not p.is_file():
            continue
        stem, idx = p.name.rsplit(".", 1)
        try:
            groups[stem].append((int(idx), p.read_text()))
        except ValueError:
            continue
    out_root = Path("tmp/large-sources")
    for stem, items in groups.items():
        items.sort()
        text = "".join(t for _, t in items)
        dest = out_root / stem
        dest.write_text(text)
        print("stitched", dest, len(text))

hex_parts = Path("tmp/large-sources/_hex_parts")
if hex_parts.exists():
    groups = defaultdict(list)
    for p in sorted(hex_parts.glob("*")):
        if not p.is_file():
            continue
        stem, idx = p.name.rsplit(".", 1)
        try:
            groups[stem].append((int(idx), p.read_text().strip()))
        except ValueError:
            continue
    out_hex = Path("tmp/large-sources/_hex")
    out_hex.mkdir(parents=True, exist_ok=True)
    for stem, items in groups.items():
        items.sort()
        text = "".join(t for _, t in items)
        dest = out_hex / stem
        dest.write_text(text + ("\n" if not text.endswith("\n") else ""))
        print("hex_stitched", dest, len(text))

hex_root = Path("tmp/large-sources/_hex")
if hex_root.exists():
    for p in sorted(hex_root.glob("*.hex")):
        stem = p.name[:-4] if p.name.endswith(".hex") else p.name
        data = bytes.fromhex(p.read_text().strip()).decode("utf-8")
        dest = Path("tmp/large-sources") / stem
        dest.write_text(data)
        print("unhex", dest, len(data))

decoded = {}
manifest_path = Path("tmp/large-sources/manifest.json")
if manifest_path.exists():
    for item in json.loads(manifest_path.read_text()):
        if item["path"].startswith(".github/workflows/"):
            print("skip workflow payload", item["path"])
            continue
        parts = []
        missing = []
        for i in range(item["chunks"]):
            p = Path("tmp/large-sources") / f"{item['prefix']}.{i:02d}"
            if not p.exists():
                missing.append(p.name)
                continue
            parts.append(p.read_text().strip())
        if missing:
            print("incomplete", item["path"], missing)
            continue
        try:
            data = gzip.decompress(base64.b64decode("".join(parts)))
        except Exception as e:
            print("corrupt", item["path"], e)
            continue
        digest = hashlib.sha256(data).hexdigest()
        if "sha256" in item and digest != item["sha256"]:
            print("sha mismatch", item["path"], digest)
            continue
        decoded[item["path"]] = data
        print("decoded", item["path"], len(data), digest[:16])
else:
    print("no manifest")

if not decoded:
    print("nothing decoded; exiting")
    raise SystemExit(0)

# Preserve large-sources tree from the PR tip so a force-push onto main does not drop payloads.
ls_backup = Path("/tmp/large-sources-backup")
if Path("tmp/large-sources").exists():
    import shutil
    if ls_backup.exists():
        shutil.rmtree(ls_backup)
    shutil.copytree("tmp/large-sources", ls_backup)
    print("backed up large-sources", ls_backup)

# Reset branch tip onto main for a clean mergeable PR.
run(["git", "fetch", "origin", "main"])
run(["git", "checkout", "-f", "-B", branch, "origin/main"])

# Restore large-sources + write decoded app sources
import shutil
if ls_backup.exists():
    Path("tmp").mkdir(exist_ok=True)
    if Path("tmp/large-sources").exists():
        shutil.rmtree("tmp/large-sources")
    shutil.copytree(ls_backup, "tmp/large-sources")
    print("restored large-sources onto main tip")

for path, data in decoded.items():
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
    print("wrote", path, len(data))

run(["git", "add", "package.json", "README.md", "src/main.js", "src/session-sync-guards.js",
     "test/session-sync-guards.test.js", "tmp/large-sources"], check=False)
if subprocess.call(["git", "diff", "--staged", "--quiet"]) == 0:
    print("No changes after overlay")
    raise SystemExit(0)
run(["git", "commit", "-m", "fix: stop Tools exchange reload flash loop (1.5.9)"])
run(["git", "push", "--force", "origin", f"HEAD:{branch}"])
print("force-pushed branch onto main + overlay")
raise SystemExit(0)
