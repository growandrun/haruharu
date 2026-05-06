const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("npm shim for this Expo project");
  console.log("Supported: npm run <script>");
  console.log("Example: npm run build:apk");
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log("npm-shim 0.1.0");
  process.exit(0);
}

const command = args[0];

if (command === "run" || command === "run-script") {
  const scriptName = args[1];
  if (!scriptName) {
    fail("Usage: npm run <script>");
  }

  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    fail("package.json was not found in the current folder.");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const script = packageJson.scripts?.[scriptName];
  if (!script) {
    const available = Object.keys(packageJson.scripts ?? {}).join(", ");
    fail(`Script '${scriptName}' was not found. Available scripts: ${available}`);
  }

  const localBin = path.join(process.cwd(), "node_modules", ".bin");
  const env = {
    ...process.env,
    PATH: `${localBin};${process.env.PATH ?? ""}`,
    Path: `${localBin};${process.env.Path ?? process.env.PATH ?? ""}`
  };

  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", script], {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}

if (command === "install" || command === "i") {
  fail(
    "This lightweight npm shim does not install packages. For this app, eas-cli is already installed locally. Use: npx eas <command>"
  );
}

fail(`Unsupported npm command '${command}'. Supported command: npm run <script>`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
