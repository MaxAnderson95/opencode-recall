#!/usr/bin/env bun
/**
 * Build the plugin as a standalone package OpenCode can install from Git: `<outDir>/index.js` with
 * the workspace's protocol package bundled in, and a `package.json` that keeps `effect` and
 * `@opencode/plugin` as ordinary dependencies. OpenCode installs a Git plugin with npm, which cannot
 * resolve `workspace:*`, so the source directory cannot be installed as it is.
 * Usage: `bun packages/plugin/build.ts <version> [outDir]`, default `dist/plugin`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import source from "./package.json"

const [version, outDir = "dist/plugin"] = process.argv.slice(2)
if (!version) {
  console.error("usage: bun packages/plugin/build.ts <version> [outDir]")
  process.exit(1)
}

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "index.ts")],
  outdir: outDir,
  target: "bun",
  external: ["effect", "@opencode/plugin"],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
await Bun.write(
  join(outDir, "package.json"),
  JSON.stringify(
    {
      name: "opencode-recall",
      version,
      type: "module",
      main: "./index.js",
      engines: source.engines,
      dependencies: { effect: source.dependencies.effect },
      peerDependencies: source.peerDependencies,
    },
    null,
    2,
  ) + "\n",
)
console.log(`built opencode-recall ${version} into ${outDir}`)
