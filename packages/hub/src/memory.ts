import { heapStats } from "bun:jsc"
import { readFileSync } from "node:fs"
import { Effect, Schedule } from "effect"
import { Archive } from "./archive/index.ts"
import { Embedder } from "./embedder.ts"

const mb = (bytes: number) => Math.round(bytes / 1e6)

/** Peak, anonymous, and file-backed resident memory from `/proc/self/status`; nothing off Linux. */
function residency(): { hwmMB?: number; anonMB?: number; fileMB?: number } {
  let status: string
  try {
    status = readFileSync("/proc/self/status", "utf8")
  } catch {
    return {}
  }
  const kB = (field: string) => {
    const match = status.match(new RegExp(`^${field}:\\s+(\\d+) kB$`, "m"))
    return match ? mb(Number(match[1]) * 1024) : undefined
  }
  return { hwmMB: kB("VmHWM"), anonMB: kB("RssAnon"), fileMB: kB("RssFile") }
}

/**
 * Log one `memory` line splitting the process's resident memory: RSS before and after a forced
 * full GC, the JS heap after it, the memory JSC tracks outside its heap (`externalMB`: array
 * buffers, the vector matrix among them), and the matrix's capacity, live rows, and removed rows.
 * What RSS holds beyond those is native: ONNX Runtime, SQLite, and Bun itself.
 */
export const report = Effect.fn("Memory.report")(function* (point: string) {
  const matrix = yield* (yield* Archive.Service).matrixStats()
  const rssMB = mb(process.memoryUsage.rss())
  Bun.gc(true)
  const heap = heapStats()
  yield* Effect.logInfo("memory").pipe(
    Effect.annotateLogs({
      point,
      rssMB,
      gcRssMB: mb(process.memoryUsage.rss()),
      ...residency(),
      heapMB: mb(heap.heapSize - heap.extraMemorySize),
      heapCapacityMB: mb(heap.heapCapacity - heap.extraMemorySize),
      externalMB: mb(heap.extraMemorySize),
      matrix: matrix && {
        capacity: matrix.capacity,
        live: matrix.live,
        removed: matrix.removed,
        allocatedMB: mb(matrix.capacity * matrix.dims * 4),
        writtenMB: mb((matrix.live + matrix.removed) * matrix.dims * 4),
      },
    }),
  )
})

/**
 * Until its scope closes, log a {@link report} at `point: "ready"` once the embedding model has
 * loaded, and at `point: "signal"` on every SIGUSR2. It waits on the model's state rather than
 * loading it, so a load that fails and is retried later still gets its report.
 */
export const watch = Effect.gen(function* () {
  const embedder = yield* Embedder.Service
  yield* embedder.state.pipe(
    Effect.repeat({ schedule: Schedule.spaced("1 second"), until: (state) => state._tag === "Loaded" }),
    Effect.andThen(report("ready")),
    Effect.forkScoped,
  )
  const context = yield* Effect.context<Archive.Service>()
  const handler = () => Effect.runForkWith(context)(report("signal"))
  yield* Effect.acquireRelease(
    Effect.sync(() => process.on("SIGUSR2", handler)),
    () => Effect.sync(() => process.off("SIGUSR2", handler)),
  )
})

export * as Memory from "./memory.ts"
