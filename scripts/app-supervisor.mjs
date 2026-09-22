import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isProduction = process.argv.includes("--production");
if (isProduction) process.env.NODE_ENV = "production";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath;
const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const readinessUrl = `${backendUrl}/api/ping`;
const backendPort = process.env.BACKEND_PORT || new URL(backendUrl).port || "3001";
const maxStartupWaitMs = Number(process.env.APP_STARTUP_TIMEOUT_MS || 120_000);
const frontendDir = path.join(rootDir, "frontend");
const nextCli = [
  path.join(frontendDir, "node_modules", "next", "dist", "bin", "next"),
  path.join(rootDir, "node_modules", "next", "dist", "bin", "next"),
].find((candidate) => fs.existsSync(candidate));

let backend = null;
let frontend = null;
let shuttingDown = false;
let restartDelayMs = 500;

function spawnNpm(args, name, env = process.env) {
  const command = npmCli ? process.execPath : npmCommand;
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const child = spawn(command, commandArgs, {
    cwd: rootDir,
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: !npmCli && process.platform === "win32",
  });
  child.on("error", (error) => {
    console.error(`[supervisor] ${name} could not start: ${error.message}`);
  });
  return child;
}

async function waitForBackend(child) {
  const startedAt = Date.now();
  while (!shuttingDown && Date.now() - startedAt < maxStartupWaitMs) {
    if (child.exitCode !== null) {
      throw new Error(`agent server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(readinessUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // Expected while the server initializes its database and providers.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`agent server was not ready after ${maxStartupWaitMs / 1000}s`);
}

async function startBackend() {
  const command = isProduction ? "start" : "dev";
  const backendEnv = {
    ...process.env,
    PORT: backendPort,
  };
  // Own the production process directly so stop/restart does not orphan a
  // grandchild server behind npm, especially on Windows.
  backend = isProduction
    ? spawn(process.execPath, [path.join(rootDir, "backend/server/dist/index.js")], {
      cwd: path.join(rootDir, "backend/server"), env: backendEnv,
      stdio: "inherit", windowsHide: true,
    })
    : spawnNpm(["run", command, "--prefix", "backend/server"], "agent server", backendEnv);
  if (isProduction) backend.on("error", (error) => {
    console.error(`[supervisor] Agent server could not start: ${error.message}`);
    shutdown(1);
  });
  const current = backend;

  current.on("exit", (code, signal) => {
    if (shuttingDown || current !== backend) return;
    const reason = signal ?? code ?? "unknown";
    console.error(`[supervisor] Agent server stopped (${reason}). Restarting in ${restartDelayMs}ms...`);
    const delay = restartDelayMs;
    restartDelayMs = Math.min(restartDelayMs * 2, 10_000);
    setTimeout(() => {
      if (!shuttingDown) void startBackend();
    }, delay);
  });

  try {
    await waitForBackend(current);
    if (current !== backend || shuttingDown) return;
    restartDelayMs = 500;
    console.log(`[supervisor] Agent server is ready at ${backendUrl}`);
    if (!frontend) startFrontend();
  } catch (error) {
    if (!shuttingDown && current === backend && current.exitCode === null) {
      console.error(`[supervisor] ${error.message}; recycling the agent server.`);
      current.kill();
    }
  }
}

function startFrontend() {
  if (!nextCli) {
    console.error("[supervisor] Next.js CLI was not found. Run npm install from the project root.");
    shutdown(1);
    return;
  }

  // The supervisor itself is launched by an npm workspace script. Starting a
  // nested npm workspace command here inherits npm's workspace lifecycle state
  // and can stall before it ever creates the Next.js process on Windows. Run
  // the declared local Next.js CLI directly so port 3000 is bound reliably.
  const command = isProduction ? "start" : "dev";
  frontend = spawn(process.execPath, [nextCli, command], {
    cwd: frontendDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  frontend.on("error", (error) => {
    console.error(`[supervisor] web app could not start: ${error.message}`);
  });
  frontend.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ?? code ?? "unknown";
    console.error(`[supervisor] Web app stopped (${reason}).`);
    shutdown(code || 1);
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (frontend?.exitCode === null) frontend.kill();
  if (backend?.exitCode === null) backend.kill();
  setTimeout(() => process.exit(exitCode), 250).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error("[supervisor] Unexpected failure:", error);
  shutdown(1);
});
process.on("unhandledRejection", (error) => {
  console.error("[supervisor] Unexpected async failure:", error);
  shutdown(1);
});

void startBackend();
