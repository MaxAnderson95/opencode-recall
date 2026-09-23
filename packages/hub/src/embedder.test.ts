import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Embedder } from "./embedder.ts"

const split = (data: unknown, dims: number[], texts: number, width: number) =>
  Effect.runPromise(Effect.result(Embedder.splitRows({ data, dims }, texts, width)))

test("a pooled tensor splits into one vector per text", async () => {
  const result = await split(new Float32Array([1, 2, 3, 4]), [2, 2], 2, 2)
  expect(result._tag === "Success" && result.success).toEqual([new Float32Array([1, 2]), new Float32Array([3, 4])])
})

test("a model wider than the configured dimensions fails instead of shifting vectors between texts", async () => {
  const result = await split(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0]), [2, 4], 2, 2)
  expect(result._tag === "Failure" && result.failure).toBeInstanceOf(Embedder.Failed)
  expect(result._tag === "Failure" && result.failure.message).toContain("returned a [2, 4] tensor for 2 texts; expected [2, 2]")
})

test("a tensor of another row count or element type fails", async () => {
  expect((await split(new Float32Array(6), [3, 2], 2, 2))._tag).toBe("Failure")
  expect((await split(new Float64Array(4), [2, 2], 2, 2))._tag).toBe("Failure")
})
