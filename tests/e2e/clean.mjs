import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
fs.rmSync(path.join(here, ".work"), { recursive: true, force: true });
console.log("Removed tests/e2e/.work");
