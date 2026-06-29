import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm, mkdir, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(artifactDir, "src");
const outDir = path.resolve(artifactDir, ".test-build");

async function collectTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTests(full)));
    } else if (entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

async function run() {
  const testFiles = await collectTests(srcDir);
  if (testFiles.length === 0) {
    console.log("No .test.ts files found.");
    return;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await esbuild({
    entryPoints: testFiles,
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "inline",
    logLevel: "warning",
  });

  const result = spawnSync(
    process.execPath,
    ["--test", `${outDir}/**/*.test.mjs`],
    { stdio: "inherit", cwd: artifactDir },
  );

  await rm(outDir, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
