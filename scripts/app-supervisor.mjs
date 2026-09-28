import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.VOID_ENV_PATH || path.join(rootDir, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const isProduction = process.argv.includes("--production");
if (!isProduction) await import('./prepare-sandbox.mjs');
if (isProduction) process.env.NODE_ENV = "production";
const backendRequire = createRequire(path.join(rootDir, "backend/server/package.json"));
const backendPort = process.env.BACKEND_PORT || (process.env.BACKEND_URL && new URL(process.env.BACKEND_URL).port) || "3001";
const frontendPort = process.env.PORT || process.env.FRONTEND_PORT || "3000";
if (backendPort === frontendPort) throw new Error("PORT and BACKEND_PORT must use different ports.");
const backendUrl = (process.env.BACKEND_URL || `http://127.0.0.1:${backendPort}`).replace(/\/$/, "");
process.env.BACKEND_URL = backendUrl;
process.env.FRONTEND_URL ||= `http://127.0.0.1:${frontendPort}`;
process.env.VOID_ENV_PATH = envPath;
const readinessUrl = `${backendUrl}/api/ping`;
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

function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    // Windows terminates a process without running SIGTERM handlers. Include
    // Next/tsx workers so a restart cannot leave the old port occupied.
    try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); }
    catch { child.kill(); }
  } else child.kill();
}

async function waitForBackend(child) {
  const startedAt = Date.now();
  while (!shuttingDown && Date.now() - startedAt < maxStartupWaitMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`agent server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(readinessUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // Expected while the agent server initializes.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`agent server was not ready after ${maxStartupWaitMs / 1000}s`);
}

async function startBackend() {
  const backendEnv = {
    ...process.env,
    PORT: backendPort,
    HOST: process.env.BACKEND_HOST || "127.0.0.1",
  };
  // Run the local CLI directly in development too, avoiding npm workspace
  // lifecycle inheritance and shell argument handling on Windows.
  const args = isProduction
    ? [path.join(rootDir, "backend/server/dist/index.js")]
    : [backendRequire.resolve("tsx/cli"), "watch", "src/index.ts"];
  backend = spawn(process.execPath, args, {
    cwd: path.join(rootDir, "backend/server"), env: backendEnv,
    stdio: "inherit", windowsHide: true,
  });
  backend.on("error", (error) => {
    console.error(`[supervisor] Agent server could not start: ${error.message}`);
    shutdown(1);
  });
  const current = backend;
  console.log(`[supervisor] Agent server process started (pid ${current.pid}).`);

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
      stopChild(current);
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
  const frontendEnv = {
    ...process.env,
    PORT: frontendPort,
  };
  frontend = spawn(process.execPath, [nextCli, command, "--port", frontendPort, "--hostname", process.env.HOST || "0.0.0.0"], {
    cwd: frontendDir,
    env: frontendEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  frontend.on("error", (error) => {
    console.error(`[supervisor] web app could not start: ${error.message}`);
    shutdown(1);
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
  stopChild(frontend);
  stopChild(backend);
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
