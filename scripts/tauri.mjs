import { spawn } from "node:child_process";
import path from "node:path";

const isWindows = process.platform === "win32";
const cli = path.join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");
const env = { ...process.env };

// Tauri's Windows resources compile reliably with MSVC. Keep other platforms
// on their native Rust host toolchain.
if (isWindows && !env.RUSTUP_TOOLCHAIN) {
  env.RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc";
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
