# Embedding model selection

Research for issue #2. Question: which embedding model should the hub use for semantic recall over OpenCode transcripts (natural language, code, tool output, reasoning), and what is the runtime path for a TypeScript/Bun hub and a Go hub?

## Recommendation

Switch from `Xenova/bge-small-en-v1.5` to `Alibaba-NLP/gte-modernbert-base` (149M params, 768 dims, 8192-token context, Apache-2.0, CLS pooling, no query prefix).

Why: on the MTEB(Code, v1) retrieval tasks it scores 71.1 nDCG@10 against 47.3 for bge-small (results repo, see method below), while staying about a third the speed of bge-small on CPU (12.8 vs 37.9 chunks/s measured here) and well inside the hub's memory budget (1.5 GB RSS under ONNX Runtime q8). It ships ONNX weights in its own repo, loads in transformers.js 4.x, converts to GGUF through llama.cpp's registered `ModernBertModel` class, and therefore has a working path from both Bun and Go. Its 8192-token window removes the 512-token truncation ceiling that constrains chunk size today.

Runner-up: `google/embeddinggemma-300m` has full benchmark coverage, similar speed, MRL dims down to 128, and the widest runtime coverage (ONNX, first-party GGUF, Ollama library). It loses on license (Google's Gemma Terms of Use with a use policy, gated download) and on query latency (33.7 ms vs 4.4 ms). Pick it only if the Gemma terms are acceptable and multilingual transcripts matter.

Not recommended: `Qwen/Qwen3-Embedding-0.6B` is the quality ceiling among small models (75.4 Code, 61.8 English retrieval) but runs at 5.4 chunks/s and 4.6 GB RSS on this machine; a 500k-chunk re-embed would take about 26 hours of CPU against 11 hours for gte-modernbert and 3.7 hours for bge-small. `BAAI/bge-m3`, `jinaai/jina-embeddings-v3` (CC-BY-NC-4.0), `nomic-embed-text-v2-moe` (512-token limit, no ONNX export) and the `nomic-embed-text-v1.5` / `e5` / `arctic-embed` families are covered in the table and rejected for the reasons given there.

Any model change forces a full re-embed of the archive. See "Switching models and re-embedding".

## Current setup and two findings about it

The plugin at `my-opencode-setup/plugins/recall` embeds with `Xenova/bge-small-en-v1.5` at `dtype: "q8"`, 384 dims, batch 8, 1200-char chunks with 200-char overlap, and prepends `Represent this sentence for searching relevant passages: ` to queries only (`lib/config.ts`, `lib/embedder-worker.ts`).

1. Pooling mismatch. The worker calls the pipeline with `pooling: "mean"`. BAAI ships bge-small-en-v1.5 with `1_Pooling/config.json` set to `pooling_mode_cls_token`, so the model was trained for CLS pooling. Mean pooling still produces usable vectors (the plugin works) but it is not the configuration the model's benchmark numbers were measured under. Locally, switching to `cls` changed nothing about speed (37.9 vs 35.7 chunks/s) and is a one-word fix. Whatever model is chosen, the hub should use that model's configured pooling.
2. Chunk size is bounded by context, not by choice. bge-small truncates at 512 tokens (`model_max_length: 512` in its tokenizer config). 1200 characters of mixed code and prose is roughly 300 to 400 tokens, so the current chunking is safe, but any move to larger chunks (fewer vectors, more context per hit) is blocked until the model has a longer window. Every recommended alternative below has 2048 or more.

## Method

Quality numbers come from the MTEB results repository (`embeddings-benchmark/results`), which is the data behind the public leaderboard. For each model I took the revision folder with the most matching task files and averaged `main_score` over the tasks in two benchmark definitions read from `mteb/benchmarks/benchmarks/benchmarks.py`:

- MTEB(Code, v1): AppsRetrieval, CodeEditSearchRetrieval, CodeFeedbackMT, CodeFeedbackST, CodeSearchNetCCRetrieval, CodeSearchNetRetrieval, CodeTransOceanContest, CodeTransOceanDL, CosQA, COIRCodeSearchNetRetrieval, StackOverflowQA, SyntheticText2SQL (12 tasks).
- MTEB(eng, v2) retrieval subset: ArguAna, CQADupstackGamingRetrieval, CQADupstackUnixRetrieval, ClimateFEVERHardNegatives, FEVERHardNegatives, FiQA2018, HotpotQAHardNegatives, SCIDOCS, TRECCOVID, Touche2020Retrieval.v3 (10 tasks).

Coverage is uneven: many models are missing `COIRCodeSearchNetRetrieval` or `FiQA2018`, and a few are missing most tasks. The table states the task count behind each mean. Means over different task subsets are only roughly comparable. Two sanity checks passed: the computed Qwen3-Embedding-0.6B means (75.41 Code, 61.82 eng retrieval) match the Qwen blog's published MTEB-Code and MTEB-R numbers exactly, and the EmbeddingGemma Code mean (68.75) matches its model card (68.76).

Speed and memory were measured on this machine (Apple M5 Pro, 48 GB, Bun 1.4.2, `@huggingface/transformers` 4.3.0 with `onnxruntime-node` 1.30.0, `dtype: "q8"`, CPU execution provider). Corpus: 64 chunks of 1200 characters cut from the plugin's TypeScript sources and this repo's Markdown docs, embedded in batches of 8 after one warm-up batch; query latency is the mean of 10 single-string calls. No x86 Linux measurement was made; treat the relative ordering as the transferable result, not the absolute numbers.

Licenses and parameter counts come from the Hugging Face model API (`cardData.license`, `safetensors.total`). Architectures come from each repo's `config.json`. Runtime support comes from the transformers.js and llama.cpp source trees on their default branches as of 2026-09-16.

## Comparison

| Model | Params | Dims (MRL) | Max tokens | License | MTEB(Code) nDCG@10 | MTEB(eng, v2) retrieval | Chunks/s (q8, M5 Pro) | Query ms | RSS MB | Bun via transformers.js | Go via ONNX (hugot/ORT) | GGUF via llama.cpp | Ollama library |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BAAI/bge-small-en-v1.5 (current) | 33M | 384 | 512 | MIT | 47.3 (11/12) | 55.4 (9/10) | 37.9 | 1.8 | 775 | yes (`Xenova/` mirror, all dtypes) | yes | yes (`BertModel`) | no first-party entry |
| Snowflake/snowflake-arctic-embed-s | 33M | 384 | 512 | Apache-2.0 | 44.2 (11/12) | 50.0 (6/10) | 37.7 | 1.8 | 767 | yes (in-repo onnx/) | yes | yes (`BertModel`) | `snowflake-arctic-embed` |
| intfloat/e5-base-v2 | 109M | 768 | 512 | MIT | 52.7 (11/12) | 50.8 (9/10) | not measured | | | yes | yes | yes (`BertModel`) | no |
| BAAI/bge-base-en-v1.5 | 109M | 768 | 512 | MIT | 48.4 (11/12) | 56.3 (9/10) | not measured | | | yes (`Xenova/` mirror) | yes | yes (`BertModel`) | no |
| nomic-ai/nomic-embed-text-v1.5 | 137M | 768 (64 to 768) | 8192 (llama.cpp caps at 2048) | Apache-2.0 | 40.4 (11/12) | 49.1 (9/10) | 14.1 | 4.2 | 1704 | yes (in-repo onnx/, `nomic_bert`) | yes | yes (`NomicBertModel`) | `nomic-embed-text` |
| Alibaba-NLP/gte-modernbert-base | 149M | 768 | 8192 | Apache-2.0 | 71.1 (10/12) | 54.0 (6/10) | 12.8 | 4.4 | 1496 | yes (in-repo onnx/, `modernbert`) | yes | yes (`ModernBertModel`); community GGUFs only | no (import a GGUF) |
| Snowflake/snowflake-arctic-embed-m-v2.0 | 305M | 768 (256) | 8192 | Apache-2.0 | 55.4 (11/12) | 58.4 (10/10) | 14.5 | 5.3 | 2341 | yes (in-repo onnx/; `gte` arch loads through base-class fallback) | yes | no (`GteModel` not registered) | no |
| google/embeddinggemma-300m | 308M | 768 (128 to 768) | 2048 | Gemma Terms of Use (gated) | 68.75 (12/12) | 55.7 (10/10) | 15.6 | 33.7 | 1889 | yes (`onnx-community/` export; `sentence_embedding` output; no fp16) | yes | yes (`Gemma3TextModel` to `GEMMA_EMBEDDING`); first-party `ggml-org` GGUFs | `embeddinggemma:300m` |
| nomic-ai/nomic-embed-text-v2-moe | 475M (305M active) | 768 (256 to 768) | 512 | Apache-2.0 | 40.5 (2/12) | not available | not measured | | | no onnx/ export | no ONNX | yes (`NOMIC_BERT_MOE`) | `nomic-embed-text-v2-moe` |
| BAAI/bge-m3 | 568M | 1024 | 8192 | MIT | 47.7 (2/12); CoIR leaderboard avg 39.31 | 51.0 (6/10) | not measured | | | yes (`Xenova/bge-m3`) | yes | yes (`XLMRobertaModel`) | `bge-m3` |
| Snowflake/snowflake-arctic-embed-l-v2.0 | 568M | 1024 (256) | 8192 | Apache-2.0 | 53.2 (11/12) | not computed | not measured | | | yes (in-repo onnx/) | yes | yes (`XLMRobertaModel`) | `snowflake-arctic-embed2` |
| jinaai/jina-embeddings-v3 | 572M | 1024 (32 to 1024) | 8192 | CC-BY-NC-4.0 | 58.0 (11/12) | 56.3 (7/10) | not measured | | | onnx/ present (fp32, fp16 only) | | yes (`XLMRobertaModel`) | no |
| Qwen/Qwen3-Embedding-0.6B | 596M | 1024 (32 to 1024) | 32768 | Apache-2.0 | 75.41 (12/12) | 61.82 (10/10) | 5.4 | 11.5 | 4642 | yes (`onnx-community/` export, `last_token` pooling, left padding) | yes | yes (`Qwen3Model`) | `qwen3-embedding:0.6b` |

Task counts in parentheses show how many of the benchmark's tasks had results. `jinaai/jina-code-embeddings-0.5b` is also CC-BY-NC-4.0 and was excluded on license. `jinaai/jina-embeddings-v2-base-code` (161M, Apache-2.0, 8192 tokens, code-specialised) has no MTEB(Code) results in the repo and was not benchmarked; its ONNX export exists but its custom `JinaBert` architecture depends on the base-class fallback in transformers.js.

## Quality for code plus chat

The transcripts are mostly English prose interleaved with code, file paths, stack traces, and tool output. Two signals matter: the MTEB(Code) retrieval tasks (code search, StackOverflow QA, text-to-SQL, code feedback) and general English retrieval.

- bge-small-en-v1.5 is competitive on English retrieval for its size (55.4) but weak on code (47.3). The CoIR leaderboard shows the same pattern one size up: bge-base-en-v1.5 averages 42.77 on CoIR against e5-base-v2 at 50.9.
- gte-modernbert-base is the strongest code retriever under 150M parameters in this set (71.1 here; the model card reports 79.31 on CoIR and 55.33 on BEIR). Its MTEB(eng, v2) retrieval mean here is 54.0 but over only 6 of 10 tasks (the hard-negative FEVER/HotpotQA/Touche tasks are missing), so treat its English retrieval as roughly on par with bge-small rather than proven better. The card's MTEB(eng, v1) average is 64.38 against bge-base's 63.55.
- EmbeddingGemma-300m and Qwen3-Embedding-0.6B are the only models with complete coverage on both benchmarks and both beat bge-small on both (68.75/55.7 and 75.41/61.82).
- nomic-embed-text-v1.5 scores below bge-small on both benchmarks (40.4 code, 49.1 English) despite its longer context; the context alone does not justify it.
- Every model in the table that beats bge-small on code is 4 to 18 times larger; there is no 33M-class model in this set that is materially better on code.

The 1200-character chunk size is compatible with every candidate. With an 8192-token model the hub could grow chunks to 2000 to 3000 characters to cut vector count, but that is a separate retrieval-strategy decision, not a model constraint.

## Storage cost

Float32 vectors: 4 bytes per dimension.

| Dims | 50k chunks | 500k chunks | 500k chunks at int8 |
| --- | --- | --- | --- |
| 384 | 77 MB | 768 MB | 192 MB |
| 768 | 154 MB | 1.54 GB | 384 MB |
| 1024 | 205 MB | 2.05 GB | 512 MB |

All 768-dim candidates double today's vector storage; at 500k chunks that is 1.5 GB of raw vectors plus index overhead, which fits a single-node SQLite or Postgres deployment. MRL models (EmbeddingGemma, arctic-embed, nomic, Qwen3) allow truncating to 256 dims for a small quality loss (arctic-m-v2.0 card: -1.8% BEIR at 256; EmbeddingGemma card: 68.76 to 66.74 MTEB Code at 256). gte-modernbert-base is not MRL-trained, so its 768 dims are fixed.

## CPU speed and memory

Measured here (see Method). bge-small and arctic-embed-s (both 33M, 6 layers, 384 hidden) embed about 38 chunks/s with a 1.8 ms query. The 137M to 308M encoders (nomic v1.5, gte-modernbert, arctic-m-v2.0, EmbeddingGemma) cluster at 13 to 16 chunks/s with 4 to 5 ms queries, except EmbeddingGemma's 33.7 ms query, which I did not root-cause (its ONNX export includes the sentence-transformers Dense layers and runs through `AutoModel` rather than the pipeline). Qwen3-Embedding-0.6B, a 28-layer decoder, runs at 5.4 chunks/s and 4.6 GB RSS.

Steady-state re-embed time for the archive at these rates:

| Model | 50k chunks | 500k chunks |
| --- | --- | --- |
| bge-small-en-v1.5 | 22 min | 3.7 h |
| gte-modernbert-base | 65 min | 10.9 h |
| embeddinggemma-300m | 53 min | 8.9 h |
| Qwen3-Embedding-0.6B | 2.6 h | 25.7 h |

Incremental indexing of new sessions is a small fraction of this. RSS includes the Bun process and ONNX Runtime; the plugin already isolates the embedder in a child process for exactly this reason, and that pattern carries over. No x86 Linux measurement was taken; ONNX Runtime's CPU provider is the same code on both, but absolute throughput on the hub's Linux host is unverified.

## Licenses

MIT: bge-small/base-en-v1.5, bge-m3, e5 family. Apache-2.0: gte-modernbert-base, gte-base-en-v1.5, nomic v1.5 and v2-moe, all arctic-embed models, jina-embeddings-v2-base-code, Qwen3-Embedding, all-MiniLM-L6-v2, mxbai-embed-large-v1. CC-BY-NC-4.0 (non-commercial, excluded): jina-embeddings-v3, jina-code-embeddings-0.5b. google/embeddinggemma-300m is under Google's Gemma Terms of Use, is gated on Hugging Face (manual acceptance), and the `onnx-community` and `ggml-org` mirrors inherit those terms. Source: Hugging Face model API `cardData.license` and `gated` fields, 2026-09-16.

## Runtime paths

### TypeScript hub on Bun

transformers.js is at 4.3.0 on npm and depends on `onnxruntime-node` 1.30.0 (Node/Bun) and `onnxruntime-web`. The plugin already runs 3.x under Bun with the embedder in a child process because `onnxruntime-node`'s NAPI teardown can crash Bun on worker termination (`lib/embedder.ts` header comment); the child is killed with SIGKILL. That constraint is unchanged in 4.x as far as this research goes: I did not test in-process teardown. In my benchmark each model ran in its own Bun process and exited via SIGKILL.

Architecture support, read from `packages/transformers/src/models/*/modeling_*.js`: `bert`, `nomic_bert`, `modernbert`, `xlm_roberta`, `gemma3`, `qwen3`, `mpnet` have dedicated classes. The `feature-extraction` pipeline uses `AutoModel`, whose `BASE_IF_FAIL = true` means an unknown encoder `model_type` (`gte` for arctic-m-v2.0, `new` for gte-base-en-v1.5, Jina's custom BERT) loads through the base `PreTrainedModel` with a logged warning; the ONNX graph is self-contained so this works, and arctic-m-v2.0 ran that way in the benchmark. Pooling options are `none`, `mean`, `cls`/`first_token`, `last_token`/`eos`.

For gte-modernbert-base: `pipeline("feature-extraction", "Alibaba-NLP/gte-modernbert-base", { dtype: "q8" })`, call with `{ pooling: "cls", normalize: true }`, no prefix on queries or documents (the model card's examples use none). Weights download from the model's own `onnx/` folder (143 MB at q8). The card lists fp32, fp16, q8, q4, q4f16 as supported dtypes.

For EmbeddingGemma: use `AutoTokenizer` + `AutoModel.from_pretrained("onnx-community/embeddinggemma-300m-ONNX", { dtype: "q8" })` and read `sentence_embedding` from the output (the pipeline's pooling is bypassed); prefix queries with `task: search result | query: ` and documents with `title: none | text: `; fp16 is unsupported.

For Qwen3-Embedding-0.6B: `onnx-community/Qwen3-Embedding-0.6B-ONNX` with `pooling: "last_token"`; the export's tokenizer config sets `padding_side: left` so batched last-token pooling is correct; queries take an `Instruct: ...\nQuery:` prefix, documents none.

### Go hub

Three viable routes, in order of coupling:

1. ONNX in-process. `knights-analytics/hugot` (Apache-2.0, v0.7.5) provides a `featureExtraction` pipeline with three backends: a pure-Go backend (GoMLX) it describes as suited to small models like all-MiniLM-L6-v2, ONNX Runtime via `-tags ORT` (its fastest CPU backend; needs `libonnxruntime.so`/`.dylib` from the ONNX Runtime releases at a configurable path plus its Rust `tokenizers.a` static lib), and OpenXLA. The lower-level `yalue/onnxruntime_go` (MIT) loads the ONNX Runtime shared library at runtime (headers pinned to 1.28.0 at time of reading) but leaves tokenization and pooling to you. Either route consumes the same `onnx/` files transformers.js uses, so a TS client and a Go hub can share one model artifact and produce byte-compatible vectors given identical tokenizer, pooling, and quantization. Cost: cgo, a platform-specific shared library to ship for darwin/arm64 and linux/amd64, and version lock-step between the Go wrapper and ORT.
2. llama.cpp sidecar. `llama-server --embedding --pooling cls` (or `mean`/`last`) exposes OpenAI-compatible `POST /v1/embeddings` and llama.cpp's own `/embedding`; `--embd-normalize 2` is the default. GGUF conversion is supported for every recommended model: `ModernBertModel`, `BertModel`, `NomicBertModel`, `XLMRobertaModel`, `Gemma3TextModel` (EmbeddingGemma), `Qwen3Model` are registered in `conversion/*.py`. `GteModel`/`NewModel` (arctic-m-v2.0, gte-base-en-v1.5) are not, which rules those two out of this route. For gte-modernbert-base only community GGUFs exist on the Hub (`cstr/gte-modernbert-base-GGUF`, `eranmazur/gte-modernbert-base-Q8_0-GGUF`, others); converting from the safetensors yourself avoids trusting them. Note llama.cpp clamps nomic v1.5 to 2048 tokens (`n_positions` fix-up in `NomicBertModel.__init__`). Cost: a second process and binary to distribute, plain HTTP from Go with no cgo.
3. Ollama. `POST /api/embed` with `model`, `input` (string or array), optional `dimensions` and `truncate`; the official Go client `github.com/ollama/ollama/api` exposes `Client.Embed`. Library coverage: `embeddinggemma:300m`, `qwen3-embedding:0.6b`, `nomic-embed-text:v1.5`, `snowflake-arctic-embed2:568m`, `bge-m3`, `all-minilm`, `mxbai-embed-large`, `granite-embedding`. There is no `gte-modernbert` library entry; using it through Ollama means `ollama create` from a GGUF Modelfile. Cost: an external daemon the user must install, and vectors from Ollama's GGUF quantization will not be byte-identical to the ONNX q8 vectors a TS client produces, so mixed-runtime archives must be embedded by one side only.

Recommendation for Go: route 1 (hugot with the ORT backend) if the hub owns embedding and wants no sidecar; route 2 if avoiding cgo matters more than a second binary. Route 3 only if Ollama is already assumed on the host.

### Cross-language consistency

If clients embed on one runtime and the hub on another, the same model can still yield slightly different vectors (ONNX q8 vs GGUF Q8_0 quantize different tensors; tokenizer implementations differ at the edges). Cosine search tolerates this, but the archive should record model id, quantization, pooling, dims and runtime per vector set, and search should never mix sets. The existing `modelTag()` (`model:dims`) is too coarse for that; it needs runtime and dtype.

## Switching models and re-embedding

Yes, changing the model forces re-embedding every chunk. Vectors from different models live in unrelated spaces; there is no mapping between bge-small's 384-dim space and gte-modernbert's 768-dim space, and cosine similarity across them is meaningless. This also applies to changing dtype (q8 to fp32) or pooling (mean to CLS) on the same model: the old and new vectors are close but not the same, and the safe procedure is a full rebuild keyed on a new tag.

The one exception is MRL truncation: for an MRL-trained model (EmbeddingGemma, Qwen3, arctic, nomic) you can truncate stored 768-dim vectors to 256 and re-normalise without re-embedding, because the leading dimensions were trained to stand alone. Going the other direction (256 back to 768) requires re-embedding. gte-modernbert-base is not MRL-trained, so its dims are a one-time choice.

Practical implication for the hub design: store the model tag with every vector set, keep the old set searchable while the new one backfills, and cut over atomically. At the measured rates a 50k-chunk backfill to gte-modernbert-base is about an hour of CPU on Apple Silicon.

## Sources

- BAAI/bge-small-en-v1.5 model card and `1_Pooling/config.json`, `tokenizer_config.json`: https://huggingface.co/BAAI/bge-small-en-v1.5
- BAAI/bge-m3 model card: https://huggingface.co/BAAI/bge-m3
- nomic-ai/nomic-embed-text-v1.5 model card: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- nomic-ai/nomic-embed-text-v2-moe model card: https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe
- Alibaba-NLP/gte-modernbert-base model card (MTEB, BEIR, LoCo, CoIR table; transformers.js dtypes): https://huggingface.co/Alibaba-NLP/gte-modernbert-base
- Alibaba-NLP/gte-base-en-v1.5 model card: https://huggingface.co/Alibaba-NLP/gte-base-en-v1.5
- Snowflake/snowflake-arctic-embed-m-v2.0 and -m-v1.5 model cards (MRL numbers): https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0 and https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v1.5
- EmbeddingGemma model card (benchmarks, prompts, terms): https://ai.google.dev/gemma/docs/embeddinggemma/model_card and https://huggingface.co/google/embeddinggemma-300m
- onnx-community/embeddinggemma-300m-ONNX usage: https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
- Qwen3-Embedding model card, GitHub README, blog (MTEB-Code 75.41, MTEB-R 61.82): https://huggingface.co/Qwen/Qwen3-Embedding-0.6B, https://github.com/QwenLM/Qwen3-Embedding, https://qwenlm.github.io/blog/qwen3-embedding/
- onnx-community/Qwen3-Embedding-0.6B-ONNX usage and `tokenizer_config.json`: https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX
- jinaai/jina-embeddings-v3 and jina-embeddings-v2-base-code model cards: https://huggingface.co/jinaai/jina-embeddings-v3, https://huggingface.co/jinaai/jina-embeddings-v2-base-code
- MTEB benchmark definitions: https://github.com/embeddings-benchmark/mteb/blob/main/mteb/benchmarks/benchmarks/benchmarks.py
- MTEB results repository (per-task JSON used for the means): https://github.com/embeddings-benchmark/results
- CoIR leaderboard and repo: https://archersama.github.io/coir/, https://github.com/CoIR-team/coir
- Hugging Face model API for licenses, gating, parameter counts, `onnx/` trees, and `config.json` architectures: `https://huggingface.co/api/models/<id>`, `https://huggingface.co/api/models/<id>/tree/main/onnx`
- transformers.js source (model directories, `AutoModel.BASE_IF_FAIL`, feature-extraction pooling, pipeline registry): https://github.com/huggingface/transformers.js (`packages/transformers/src/models/auto/modeling_auto.js`, `.../models/registry.js`, `.../pipelines/feature-extraction.js`, `.../pipelines/index.js`); npm `@huggingface/transformers@4.3.0` dependency list
- llama.cpp converter registrations: https://github.com/ggml-org/llama.cpp (`conversion/bert.py`, `conversion/gemma.py`, `conversion/qwen.py`); server embeddings flags and endpoints: `tools/server/README.md`
- knights-analytics/hugot README (backends, ORT shared library, tokenizer requirements): https://github.com/knights-analytics/hugot
- yalue/onnxruntime_go README (shared library loading, header version): https://github.com/yalue/onnxruntime_go
- Ollama API `POST /api/embed` and Go client `Client.Embed`: https://github.com/ollama/ollama/blob/main/docs/api.md, https://github.com/ollama/ollama/blob/main/api/client.go; library pages under https://ollama.com/library/
- Local plugin reference: `~/my-opencode-setup/plugins/recall/lib/config.ts`, `lib/embedder.ts`, `lib/embedder-worker.ts`
- Local benchmark: Bun 1.4.2, `@huggingface/transformers` 4.3.0, Apple M5 Pro, 2026-09-17; script and raw JSON lines are not committed
