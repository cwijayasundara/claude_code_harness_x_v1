import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  stdio: "inherit"
});
process.exit(result.status ?? 1);
