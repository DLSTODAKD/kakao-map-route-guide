import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp } from "node:fs/promises";
import { execSync } from "node:child_process";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");

  // ── Step 1: Clear dist ──────────────────────────────────────────────────
  await rm(distDir, { recursive: true, force: true });

  // ── Step 2: Build Express server (esbuild) ──────────────────────────────
  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // ── Step 3: Build Vite frontend ─────────────────────────────────────────
  console.log("Building frontend (Vite)...");
  const frontendDir = path.resolve(workspaceRoot, "artifacts/samcheok-bus-web");
  const frontendDistSrc = path.resolve(frontendDir, "dist/public");
  const frontendDistDest = path.resolve(distDir, "public");

  try {
    execSync(
      "pnpm --filter @workspace/samcheok-bus-web run build",
      {
        cwd: workspaceRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          PORT: "3000",        // required by vite.config.ts (used only for dev server)
          BASE_PATH: "/",      // serve at root in production
          NODE_ENV: "production",
        },
      }
    );

    // ── Step 4: Copy Vite output into dist/public/ ──────────────────────
    await cp(frontendDistSrc, frontendDistDest, { recursive: true });
    console.log(`Frontend copied to dist/public/`);
  } catch (err) {
    console.warn("⚠ Frontend build failed — server will start without static files:", err.message ?? err);
    // Don't exit; API still works without the frontend
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
