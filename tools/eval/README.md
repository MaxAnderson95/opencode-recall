# Retrieval eval

Measures recall quality against real usage, so changes to the embedding model, chunking, fusion, or ranking are decided by a number rather than by argument.

It exists because two well-supported improvements did not survive being measured. `gte-modernbert-base` was recommended on an MTEB(Code) score of 71.1 against `bge-small`'s 47.3 and gained 0.0136 MRR@10 on real conversation transcripts. Hosted embedding models beat the incumbent by 0.024 to 0.040 on the semantic branch alone and by a statistically indistinguishable 0.011 once RRF fusion was applied. Three rerankers made results worse. See issue #6.

## What it measures

Labels come from real behaviour, not from synthetic queries. Every `recall_search` call in OpenCode's own database is paired with the `recall_expand` or `recall_inspect` that followed it in the same conversation, which is an implicit judgment that the session opened was the one wanted. That yields a few hundred queries with at least one known-relevant session each.

Scoring is at **session level**, because `recall_search` returns ranked sessions. Scoring exact chunks instead punishes a system for surfacing a different, equally correct chunk from the right session, which transcripts are full of.

Scoring runs the **whole hybrid pipeline**, not one branch. The lexical branch and the RRF fusion are imported from the implementation under test rather than reimplemented, so the eval cannot drift from production. `src/retrieval.ts` is the only file that knows where they come from; point `EVAL_RETRIEVAL_DIR` at the hub's Archive module once that exists.

## Running it

```sh
bun install
bun run mine       # build labels from OpenCode's database, into data/
bun run baseline   # BM25-only, semantic-only, and hybrid for the current setup
bun run misses     # why queries fail, grouped by cause
```

Comparing a candidate embedding model against the incumbent, through the full pipeline, with a paired significance test. Any OpenAI-compatible `/embeddings` endpoint works. Vectors are cached in `data/`, so re-scoring after the first run is free.

```sh
export EVAL_EMBED_API_KEY=...
bun run compare --model voyageai/voyage-4-lite --dims 512 --input-type
```

Configuration is environment variables, all optional: `EVAL_INDEX_DB`, `EVAL_OPENCODE_DB`, `EVAL_RETRIEVAL_DIR`, `EVAL_DATA_DIR`.

## Reading the results

`data/` is git-ignored and must stay that way. Mined labels contain verbatim query text from private sessions, including internal system and account names. Regenerate them locally with `bun run mine`; never commit them.

Two properties of the labels shape what the numbers can support.

Relevance is **incomplete**. A label records the session the human opened, not every session that would have served. Recall is therefore a lower bound, which is fine for comparing two systems on the same labels and wrong to read as absolute quality.

Labels carry **incumbent bias**. The human could only open something the current ranking showed them, so the incumbent is structurally favoured and a challenger that surfaces something genuinely better may be scored down for it. A challenger that wins anyway has won against a loaded baseline. This bias is much stronger against rerankers, which permute the exact order the human saw, so treat reranking results here as weak evidence.

Small differences are usually nothing. `compare` reports a paired bootstrap interval and a permutation test for that reason: on a few hundred queries an MRR gap under about 0.03 will not separate from noise.
