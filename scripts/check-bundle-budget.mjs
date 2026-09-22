import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const distDir = resolve(root, "dist");
const budgetBytes = 200 * 1024;

function collect(dir) {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collect(path));
    } else if (/\.(js|css)$/.test(entry.name)) {
      entries.push(path);
    }
  }
  return entries;
}

let total = 0;
const rows = [];
for (const path of collect(distDir)) {
  const size = gzipSync(readFileSync(path)).length;
  total += size;
  rows.push([path.slice(distDir.length + 1), size]);
}

rows.sort((a, b) => b[1] - a[1]);
for (const [name, size] of rows) {
  console.log(`${name.padEnd(48)} ${String(size).padStart(7)} B gzip`);
}
console.log(`${"total".padEnd(48)} ${String(total).padStart(7)} B / budget ${budgetBytes} B`);

if (total > budgetBytes) {
  console.error(`FAIL: bundle exceeds gzip budget by ${total - budgetBytes} B`);
  process.exit(1);
}
