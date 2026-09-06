---
name: knowledge-base
description: Maintain and query the per-workspace pi-knowledge RAG index (knowledge_* tools); when to add/update, env-var switches, Spark vs local embedding modes.
---
# Knowledge Base

pi-knowledge (pinned `pi-knowledge@0.10.0`) provides local-first semantic + keyword search over project files. The extension ships its own generic `search-docs` skill for query technique; this skill covers operations in THIS image.

## Layout

- Store: `~/.omp/knowledge/` — volume `omp-devcontainer-base-omp-home`, so KBs survive container restarts and image rebuilds.
- Models: pre-seeded on first boot from `/usr/local/share/omp-defaults/knowledge-models/` into `~/.omp/knowledge/models/` (the extension's model cache). Offline first use works — no Hugging Face needed at runtime.
- Env: `~/.omp/knowledge.env` — persistent, user-editable; sourced from `~/.zshrc` after the floor exports, so it wins for omp processes.

## Workflow

1. First session: `knowledge_show` — if no KB exists for this repo, `knowledge_add` with `path` = repo root, `name` = basename of the repo directory.
2. After meaningful edits to indexed content or new major docs: `knowledge_update`.
3. Health check when search quality looks wrong: `knowledge_doctor` (embedder, store writability, FTS5, model cache).
4. Search before re-reading: for questions about project files not open in context, run `knowledge_search` first.

## Embedding modes

Set in `~/.omp/knowledge.env` (takes effect for new omp sessions):

| `PI_KNOWLEDGE_EMBEDDING` | Behavior |
| --- | --- |
| unset (default) or `local:multilingual-e5-small` | Local ONNX embedder (`~/.omp/knowledge/models`), zero config, works offline |
| `openai:<model>` | OpenAI-compatible embeddings endpoint; `PI_KNOWLEDGE_EMBEDDING_BASE_URL` points it at the Spark proxy; `PI_KNOWLEDGE_EMBEDDING_API_FALLBACK=local` degrades to the local ONNX embedder if the endpoint fails |

Only `local` and `openai` providers are supported (anything else is a hard error). A KB's vectors are bound to one embedding signature — switching embedders requires re-indexing the KB (`knowledge_add`/`knowledge_update` rebuilds vectors).

## Spark upgrade procedure

1. Confirm the LiteLLM proxy exposes an embedding model: `GET /v1/models` for the model name (currently none registered — `/v1/embeddings` returns 400).
2. Edit `~/.omp/knowledge.env`: uncomment the three `PI_KNOWLEDGE_EMBEDDING*` lines.
3. Re-index existing KBs: `knowledge_add`/`knowledge_update` (vectors rebuilt; mixing providers in one KB is unsupported).
4. Verify: `knowledge_doctor` reports the openai embedder, and a hybrid query returns hits.
5. To fall back: re-comment the lines and re-index.

## Do not

- Set `PI_KNOWLEDGE_WATCH` / `PI_KNOWLEDGE_AUTO_INJECT` (out of scope; the agent drives `knowledge_update`).
- Store KBs outside `~/.omp` or commit `~/.omp/knowledge/` anywhere (volume state, not repo content).
- Index secrets — `.env` files are excluded by default ignores; keep it that way.
- Delete `~/.omp/knowledge/models` unless re-downloading is intended: a full reset (`rm -rf ~/.omp/knowledge/`) re-seeds models + env only on the next container **creation** (`postCreateCommand`), not on plain restart.
