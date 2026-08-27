import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFiles = [
  "node_modules/html2canvas/dist/html2canvas.esm.js",
  "node_modules/html2canvas/dist/html2canvas.js",
  "node_modules/html2canvas/dist/html2canvas.min.js",
  "node_modules/html2canvas/dist/lib/css/types/color.js",
];

const patterns = [
  /throw new Error\("Attempting to parse an unsupported color function \\"" \+ value\.name \+ "\\""\);/g,
  /throw new Error\('Attempting to parse an unsupported color function "'\+e\.name\+'"'\);/g,
  /throw new Error\("Attempting to parse an unsupported color function "'\+e\.name\+'"'\);/g,
];

const replacement = "return 0; /* PDF safe fallback */";

let patchedCount = 0;

for (const relPath of targetFiles) {
  const fullPath = path.resolve(__dirname, "..", relPath);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, "utf8");
    let changed = false;
    for (const pat of patterns) {
      if (content.match(pat)) {
        content = content.replace(pat, replacement);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(fullPath, content, "utf8");
      console.log(`[patch-html2canvas] Successfully patched: ${relPath}`);
      patchedCount++;
    } else {
      console.log(`[patch-html2canvas] Already patched or pattern not found: ${relPath}`);
    }
  } else {
    console.log(`[patch-html2canvas] File not found (skipped): ${relPath}`);
  }
}

console.log(`[patch-html2canvas] Done. Patched ${patchedCount} files.`);
