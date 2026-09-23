# Retrieval eval

Measures recall quality against real usage, so changes to the embedding model, chunking, fusion, or ranking are decided by a number rather than by argument.

It exists because two well-supported improvements did not survive being measured. `gte-modernbert-base` was recommended on an MTEB(Code) score of 71.1 against `bge-small`'s 47.3 and gained 0.0136 MRR@10 on real conversation transcripts. Hosted embedding models beat the incumbent by 0.024 to 0.040 on the semantic branch alone and by a statistically indistinguishable 0.011 once RRF fusion was applied. Three rerankers made results worse. See issue #6.

## What it measures

Labels come from real behaviour, not from synthetic queries. Every `recall_search` call in OpenCode's own database is paired with the `recall_expand` or `recall_inspect` that followed it in the same conversation, which is an implicit judgment that the session opened was the one wanted. That yields a few hundred queries with at least one known-relevant session each.

Scoring is at **session level**, because `recall_search` returns ranked sessions. Scoring exact chunks instead punishes a system for surfacing a different, equally correct chunk from the right session, which transcripts are full of.

Scoring runs through the **hub's Archive module**: every label becomes the `Search` that `recall_search` would send, with the calling session excluded, and `archive.search` answers it in `lexical`, `semantic`, and `hybrid` mode. Chunking, the embedder, both branches, the filters, and the RRF fusion are all production code; the eval contains no retrieval logic of its own.

## Running it

```sh
bun run mine       # build labels from OpenCode's database, into data/labels.json
bun run freeze     # freeze those labels and a corpus built from OpenCode's database, into data/corpus/
bun run baseline   # BM25-only, semantic-only, and hybrid over the frozen corpus
```

`freeze` reads every v2 session through the plugin's own extraction, keeps messages up to the newest labelled search, leaves out sessions under the host's `index.excludeDirectories` (from `recall.json`), archives them with the hub's `putSnapshot`, and embeds every chunk with the hub's embedder. That is a full embed: about 74,700 chunks, which ran at 12 to 13 chunks/s on an M5 Pro. Rerunning `freeze` after an interruption during embedding resumes it; it refuses to overwrite any other existing corpus.

`data/corpus/freeze.json` records the cutoff, the exclusions, a hash of the labels, and a fingerprint of the archive: every session's content hash, the chunk and vector counts, and the vector space recipe. `baseline` refuses a corpus that no longer matches its record, or that was frozen at another archive schema version, so scoring one frozen corpus again gives identical numbers. A change to chunk rendering or the embedding recipe needs a new corpus.

Configuration is environment variables, all optional: `EVAL_OPENCODE_DB` (only ever opened read-only; point it at a copy to avoid reading the live file) and `EVAL_DATA_DIR`. Model files are cached in `<data>/models`.

## Checking a refactor for retrieval parity

A change that should not move retrieval, such as a refactor, can be checked without a full freeze. `src/parity.ts` builds a small archive (200 sessions of at most 60 messages, covering the first 40 labels whose relevant sessions fit) through a real `serve` process of a given checkout, embeds it with the real model, and records the ranked sessions and hits for those labels in `lexical`, `semantic`, and `hybrid` mode. It talks to the hub only through its CLI and HTTP API, so the same script runs against the checkout before and after the change:

```sh
sqlite3 -readonly ~/.local/share/opencode/opencode.db ".backup $TMP/opencode.db"
bun src/parity.ts <before-checkout> $TMP/opencode.db data/labels.json <models dir> $TMP/before $TMP/before.json
bun src/parity.ts <after-checkout> $TMP/opencode.db data/labels.json <models dir> $TMP/after $TMP/after.json
cmp <(jq -S .results $TMP/before.json) <(jq -S .results $TMP/after.json)
```

The models directory is copied into each work directory, so a model already downloaded at the pinned revision is reused. On an M5 Pro one run embeds about 1,600 chunks in under a minute. The outputs hold private session ids and must stay out of the repository like `data/`.

## Reading the results

`data/` is git-ignored and must stay that way. Mined labels contain verbatim query text from private sessions, including internal system and account names, and the frozen archive holds whole transcripts. Regenerate them locally; never commit them.

The `Hit@K` columns are hit rates: the share of queries with any relevant session in the top K. They are not recall, since some queries have several relevant sessions and one is enough.

Two properties of the labels shape what the numbers can support.

Relevance is **incomplete**. A label records the session the human opened, not every session that would have served. The numbers are therefore a lower bound, which is fine for comparing two systems on the same labels and wrong to read as absolute quality.

Labels carry **incumbent bias**. The human could only open something the ranking of the day showed them, so that ranking is structurally favoured and a challenger that surfaces something genuinely better may be scored down for it. This bias is much stronger against rerankers, which permute the exact order the human saw, so treat reranking results as weak evidence.

Small differences are usually nothing: on a few hundred queries an MRR gap under about 0.03 will not separate from noise.
