const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanSecrets } = require("../lib/secret-scan");

test("finds known credential patterns only in the requested files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-"));
  fs.writeFileSync(path.join(root, "safe.js"), "const token = process.env.TOKEN;\n");
  fs.writeFileSync(path.join(root, "unsafe.js"), "const apiKey = 'abcdefghijk';\n");

  assert.deepEqual(scanSecrets(root, ["safe.js"]), []);
  assert.equal(scanSecrets(root, ["unsafe.js"])[0].name, "Hard-coded credential assignment");
});
