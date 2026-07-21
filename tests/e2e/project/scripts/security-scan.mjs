import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve("src");
const findings = [];
for (const entry of fs.readdirSync(sourceRoot, { recursive: true })) {
  if (!/\.[cm]?[jt]sx?$/.test(entry)) continue;
  const file = path.join(sourceRoot, entry);
  const content = fs.readFileSync(file, "utf8");
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(content)) findings.push(entry);
}
if (findings.length) {
  console.error(`Dynamic code execution found in: ${findings.join(", ")}`);
  process.exit(1);
}
console.log("Fixture static security scan passed");
