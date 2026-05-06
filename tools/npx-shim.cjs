const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("npx shim for this Expo project");
  console.log("Supported: npx <local-bin> [...args]");
  console.log("Examples: npx eas login, npx eas build --platform android --profile preview");
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log("npx-shim 0.1.0");
  process.exit(0);
}

const binaryName = args[0];
const binaryArgs = args.slice(1);
const localBin = path.join(process.cwd(), "node_modules", ".bin");
const candidates = [
  path.join(localBin, `${binaryName}.cmd`),
  path.join(localBin, binaryName)
];
const binaryPath = candidates.find((candidate) => fs.existsSync(candidate));

if (!binaryPath) {
  console.error(`Local executable '${binaryName}' was not found in ${localBin}`);
  console.error("This lightweight npx shim runs packages already installed in this project.");
  process.exit(1);
}

const env = {
  ...process.env,
  PATH: `${localBin};${process.env.PATH ?? ""}`,
  Path: `${localBin};${process.env.Path ?? process.env.PATH ?? ""}`
};

const result = spawnSync(binaryPath, binaryArgs, {
  cwd: process.cwd(),
  env,
  shell: true,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
