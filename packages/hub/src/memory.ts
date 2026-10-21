import { heapStats } from "bun:jsc"
import { Effect, Option } from "effect"
import { Archive } from "./archive/index.ts"

/**
 * Log one `memory` line: the process's RSS, the JSC heap read right after a forced full GC, and
 * the vector matrix's capacity, used slots, live rows, and allocation, when it is loaded. Sizes are
 * bytes. `jscExtraMemory` is memory JSC tracks outside its heap, such as array buffers; the matrix
 * is one. What RSS holds beyond the JSC heap is native: ONNX Runtime, SQLite, and Bun itself.
 */
export const report = Effect.fn("Memory.report")(function* () {
  const matrix = yield* (yield* Archive.Service).vectorStats()
  Bun.gc(true)
  const heap = heapStats()
  yield* Effect.logInfo("memory").pipe(
    Effect.annotateLogs({
      rss: process.memoryUsage().rss,
      jscHeapSize: heap.heapSize,
      jscHeapCapacity: heap.heapCapacity,
      jscExtraMemory: heap.extraMemorySize,
      jscObjects: heap.objectCount,
      ...Option.match(matrix, {
        onNone: () => ({}),
        onSome: ({ capacity, slots, live, dims }) => ({
          matrixCapacity: capacity,
          matrixSlots: slots,
          matrixLive: live,
          matrixBytes: capacity * dims * Float32Array.BYTES_PER_ELEMENT,
        }),
      }),
    }),
  )
})

export * as Memory from "./memory.ts"
