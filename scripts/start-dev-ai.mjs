import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const nodePath = process.execPath;
const aiPort = process.env.AI_SERVER_PORT ?? "8787";
const appPort = process.env.EXPO_PORT ?? "8081";
const lanIp = process.env.EXPO_PACKAGER_HOSTNAME ?? getLanIp() ?? "localhost";
const expoCli = path.join(process.cwd(), "node_modules", "expo", "bin", "cli");

const aiServer = spawn(nodePath, ["server/ai-server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_SERVER_PORT: aiPort
  },
  stdio: "inherit"
});

const expo = spawn(nodePath, [expoCli, "start", "--web", "--port", appPort, "--host", "lan"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CI: "1",
    EXPO_PACKAGER_HOSTNAME: lanIp,
    EXPO_PUBLIC_AI_ENDPOINT: `http://${lanIp}:${aiPort}/analyze-day`
  },
  stdio: "inherit"
});

console.log(`App URL: http://${lanIp}:${appPort}`);
console.log(`AI endpoint: http://${lanIp}:${aiPort}/analyze-day`);

function shutdown() {
  aiServer.kill();
  expo.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return undefined;
}
