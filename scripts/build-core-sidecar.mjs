import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

if (process.platform !== "win32")
  throw new Error(
    "The Phase 23 sidecar builder currently targets Windows only",
  );

const root = resolve(import.meta.dirname, "..");
const runtimeRequire = createRequire(
  resolve(root, "services/browser/package.json"),
);
const buildRoot = resolve(root, ".jarvis-build");
const bundlePath = resolve(buildRoot, "jarvis-core.cjs");
const blobPath = resolve(buildRoot, "jarvis-core.blob");
const seaConfigPath = resolve(buildRoot, "sea-config.json");
const binaryDirectory = resolve(root, "apps/dashboard/src-tauri/binaries");
const binaryPath = resolve(
  binaryDirectory,
  "jarvis-core-x86_64-pc-windows-msvc.exe",
);
const resourceDirectory = resolve(root, "apps/dashboard/src-tauri/resources");
const browserRuntimeDirectory = resolve(resourceDirectory, "browser-runtime");

await mkdir(buildRoot, { recursive: true });
await mkdir(binaryDirectory, { recursive: true });
await rm(resourceDirectory, { recursive: true, force: true });
await mkdir(resolve(browserRuntimeDirectory, "node_modules"), {
  recursive: true,
});
await copyFile(
  resolve(root, "jarvis.config.yaml"),
  resolve(resourceDirectory, "jarvis.config.yaml"),
);
await writeFile(
  resolve(browserRuntimeDirectory, "package.json"),
  JSON.stringify({ private: true, type: "commonjs" }),
  "utf8",
);
await cp(
  dirname(runtimeRequire.resolve("playwright-core/package.json")),
  resolve(browserRuntimeDirectory, "node_modules/playwright-core"),
  { recursive: true },
);
await build({
  entryPoints: [resolve(root, "services/core/src/main.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: false,
  minify: false,
  external: [
    "node:*",
    "chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
    "chromium-bidi/lib/cjs/cdp/CdpConnection",
  ],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
await writeFile(
  seaConfigPath,
  JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }),
  "utf8",
);

async function run(executable, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectRun);
    child.once("exit", (code) =>
      code === 0
        ? resolveRun()
        : rejectRun(new Error(`${executable} exited with ${String(code)}`)),
    );
  });
}

await run(process.execPath, ["--experimental-sea-config", seaConfigPath]);
await copyFile(process.execPath, binaryPath);
await run(process.execPath, [
  resolve(root, "node_modules/postject/dist/cli.js"),
  binaryPath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
]);
console.log(JSON.stringify({ sidecar: binaryPath }));
