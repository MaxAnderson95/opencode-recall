#!/usr/bin/env bun
/**
 * Compile the hub into one Linux executable for this machine's architecture:
 * `<outDir>/opencode-recall-hub`, beside the `libonnxruntime.so.1` it needs on the library path.
 * Bun embeds ONNX Runtime's Node addon in the executable but not the shared library the addon
 * links against. Usage: `bun packages/hub/build.ts [outDir]`, default `dist`.
 */
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

if (process.platform !== "linux") {
  console.error(`the hub is built for Linux only, not ${process.platform}`)
  process.exit(1)
}
const outDir = process.argv[2] ?? "dist"
const transformers = Bun.resolveSync("@huggingface/transformers", import.meta.dir)
const ort = dirname(Bun.resolveSync("onnxruntime-node/package.json", dirname(transformers)))

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/main.ts")],
  compile: { outfile: join(outDir, "opencode-recall-hub") },
  plugins: [
    {
      name: "embeddable-transformers",
      setup(build) {
        // transformers.js loads ONNX Runtime through `createRequire`, which the bundler cannot see,
        // so the compiled executable would look for it on disk. A plain `require` gets it bundled.
        build.onLoad({ filter: /[\\/]transformers\.node\.mjs$/ }, async ({ path }) => {
          const source = await Bun.file(path).text()
          const bundled = source.replace('requireFromHere("onnxruntime-node")', 'require("onnxruntime-node")')
          if (bundled === source) throw new Error(`${path} no longer loads onnxruntime-node the way this build expects`)
          return { contents: bundled, loader: "js" }
        })
        // sharp is for image models and needs native libraries of its own. transformers.js refuses
        // to load without a truthy import, so this stands in for it and fails only if called.
        build.onResolve({ filter: /^sharp$/ }, () => ({ path: "sharp", namespace: "no-sharp" }))
        build.onLoad({ filter: /.*/, namespace: "no-sharp" }, () => ({
          contents: `export default function sharp() { throw new Error("image processing is not built into the hub") }`,
          loader: "js",
        }))
      },
    },
  ],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })
copyFileSync(join(ort, "bin/napi-v6/linux", process.arch, "libonnxruntime.so.1"), join(outDir, "libonnxruntime.so.1"))
console.log(`built ${join(outDir, "opencode-recall-hub")} and ${join(outDir, "libonnxruntime.so.1")}`)
