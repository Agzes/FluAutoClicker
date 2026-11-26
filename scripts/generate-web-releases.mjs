import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const NOTES_DIR = path.join(ROOT, "docs", "release-notes");
const UPDATES_DIR = path.join(ROOT, "docs", "updates");
const OUTPUT_FILE = path.join(ROOT, "web", "releases.json");
const REPO_URL = "https://github.com/Agzes/FluAutoClicker";

function normalizeVersion(raw) {
    return String(raw || "")
        .trim()
        .replace(/\.md$/i, "")
        .replace(/^v\.?/i, "");
}

function parseSemver(raw) {
    const cleaned = normalizeVersion(raw).split("+")[0];
    const dashIdx = cleaned.indexOf("-");
    const coreStr = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
    const preStr = dashIdx >= 0 ? cleaned.slice(dashIdx + 1) : "";
    return {
        core: coreStr.split(".").map((part) => {
            const n = Number.parseInt(part, 10);
            return Number.isFinite(n) ? n : 0;
        }),
        pre: preStr,
    };
}

function compareVersionsDesc(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    const len = Math.max(pa.core.length, pb.core.length);
    for (let i = 0; i < len; i += 1) {
        const va = pa.core[i] || 0;
        const vb = pb.core[i] || 0;
        if (va !== vb) return vb - va;
    }
    if (!pa.pre && !pb.pre) return 0;
    if (!pa.pre) return -1;
    if (!pb.pre) return 1;
    const leftParts = pa.pre.split(".");
    const rightParts = pb.pre.split(".");
    const maxPre = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < maxPre; i += 1) {
        const lp = leftParts[i];
        const rp = rightParts[i];
        if (lp === rp) continue;
        if (lp === undefined) return 1;
        if (rp === undefined) return -1;
        const ln = Number.parseInt(lp, 10);
        const rn = Number.parseInt(rp, 10);
        if (String(ln) === lp && String(rn) === rp) {
            return rn - ln;
        }
        return rp.localeCompare(lp);
    }
    return 0;
}

function formatTag(raw) {
    const norm = normalizeVersion(raw);
    return norm ? `v${norm}` : "";
}

function readJsonIfExists(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

const noteFiles = fs.existsSync(NOTES_DIR)
    ? fs
          .readdirSync(NOTES_DIR)
          .filter((name) => name.toLowerCase().endsWith(".md"))
          .sort((a, b) => compareVersionsDesc(a, b))
    : [];

const releases = noteFiles.map((name) => {
    const markdown = fs.readFileSync(path.join(NOTES_DIR, name), "utf8");
    return {
        name,
        tag: formatTag(name),
        markdown,
    };
});

const stableManifest = readJsonIfExists(path.join(UPDATES_DIR, "latest.json"));
const betaManifest = readJsonIfExists(
    path.join(UPDATES_DIR, "latest-beta.json"),
);

const latestCandidates = [];
for (const manifest of [stableManifest, betaManifest]) {
    if (
        manifest &&
        manifest.version &&
        manifest.notes !== "-" &&
        !/\/releases\/?$/.test(manifest.github_url || "")
    ) {
        latestCandidates.push({
            tag: formatTag(manifest.version),
            url: manifest.github_url || `${REPO_URL}/releases/latest`,
        });
    }
}
if (releases.length > 0) {
    latestCandidates.push({
        tag: releases[0].tag,
        url: `${REPO_URL}/releases/tag/${releases[0].tag}`,
    });
}

latestCandidates.sort((a, b) => compareVersionsDesc(a.tag, b.tag));
const latest = latestCandidates[0] || {
    tag: "v0.1.0-beta.9",
    url: `${REPO_URL}/releases/latest`,
};

const payload = {
    generated_at: new Date().toISOString(),
    latest,
    releases,
};

fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
    `Generated ${path.relative(ROOT, OUTPUT_FILE)} with ${releases.length} releases (latest: ${latest.tag})`,
);
