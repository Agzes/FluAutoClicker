import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
const version = packageJson.version;

let failed = false;

const cargoToml = readFileSync(cargoPath, "utf8");
const cargoVersion = cargoToml.match(/^version = "([^"]+)"$/m)?.[1];
if (!cargoVersion) {
  console.error("FAIL: version not found in Cargo.toml");
  process.exit(1);
}
if (cargoVersion !== version) {
  if (checkOnly) {
    console.error(`FAIL: Cargo.toml version ${cargoVersion} != package.json ${version}`);
    failed = true;
  } else {
    writeFileSync(
      cargoPath,
      cargoToml.replace(/^version = "[^"]+"$/m, `version = "${version}"`),
    );
    console.log(`Cargo.toml → ${version}`);
  }
}

const tauriRaw = readFileSync(tauriPath, "utf8");
const tauriVersion = tauriRaw.match(/"version":\s*"([^"]+)"/)?.[1];
if (!tauriVersion) {
  console.error("FAIL: version not found in tauri.conf.json");
  process.exit(1);
}
if (tauriVersion !== version) {
  if (checkOnly) {
    console.error(`FAIL: tauri.conf.json version ${tauriVersion} != package.json ${version}`);
    failed = true;
  } else {
    writeFileSync(
      tauriPath,
      tauriRaw.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`),
    );
    console.log(`tauri.conf.json → ${version}`);
  }
}

if (failed) {
  console.error("FAIL: run `pnpm run version:sync` to fix");
  process.exit(1);
}

if (!checkOnly) {
  console.log(`version ${version} in sync`);
}
