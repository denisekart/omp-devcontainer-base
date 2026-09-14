# Model Configuration & Roles

## Important for external users

The image seeds a default `models.yml` whose `baseUrl` is **the image author's** LiteLLM endpoint (`http://spark.orca-hue.ts.net:4000/v1`). It will not be reachable from your machine.

You **MUST** point `models.yml` at your own OpenAI-compatible endpoint (LiteLLM or any OpenAI-compatible gateway):

- Edit the repository-level `.omp/models.yml` (recommended — it is committed and shared with your team). omp reads model config **only** from `~/.omp/agent/models.yml`, and `seed-omp-home.sh` (postCreate/postStart) keeps that path as a pointer (symlink) to the current workspace's `.omp/models.yml` — so editing the workspace file edits exactly what omp reads. To use a purely user-level config instead, replace `~/.omp/agent/models.yml` with a real file of your own; seeding respects it and stops pointing at the workspace file.
- For LLM servers running on the host machine, use `http://host.docker.internal:<port>/v1` as the `baseUrl` — inside the container, `localhost` refers to the container itself.

This is the single most common onboarding failure; it is also covered in [getting-started.md](getting-started.md) (section 5) and [troubleshooting.md](troubleshooting.md).


`oh-my-pi` uses a two-tier configuration system to manage LLMs:

1.  **Definitions (`models.yml`)**: Defines *where* the models are (endpoints, API keys, APIs).
2.  **Mappings (`config.yml`)**: Assigns those defined models to specific **roles** (capabilities) used by the agent.

### 1. Global Configuration (User Level)

The base image seeds default configurations into your user home directory:

-   **`~/.omp/agent/models.yml`**: Pointer (symlink) maintained by `seed-omp-home.sh` to the workspace `.omp/models.yml` (see section 2); its target contains the provider definitions. By default, it connects to LiteLLM serving Qwen models with reasoning controls.
    ```yaml
    providers:
      litellm:
        api: openai-completions
        baseUrl: "http://spark.orca-hue.ts.net:4000/v1"
        apiKey: "anything"
        models:
          # --- Qwen 3.8 (27B) with Dynamic Thinking & Reasoning Levels ---
          # Official recommendations (https://huggingface.co/Qwen/Qwen3.8-27B):
          #   Thinking mode (default, xhigh): temp 1.0, top_p 0.95, top_k 20, min_p 0.0,
          #                                   presence_penalty 0.0, repetition_penalty 1.0
          #   Non-thinking mode (instruct):   temp 0.7, top_p 0.80, top_k 20, min_p 0.0,
          #                                   presence_penalty 1.5, repetition_penalty 1.0
          #   Reasoning effort: xhigh (default), medium, low
          #   preserve_thinking: true enabled by default for all workloads
          #   Default mode: thinking (xhigh); non-thinking (instruct) mode supported
          # vLLM backend: --max-model-len 230000 --max-num-seqs 2 --max-num-batched-tokens 32768
          # (2 concurrent sequences — keep subagents.parallel.concurrency at 2)
          - id: "qwen3.8-27b"
            name: "Qwen 3.8 (27B)"
            reasoning: true
            input: ["text", "image"]
            contextWindow: 230000
            maxTokens: 16384
            thinking:
              mode: effort
              efforts: ["low", "medium", "xhigh"]
              defaultLevel: xhigh
            compat:
              thinkingFormat: "qwen-chat-template"
              qwenTemplateReasoningEffort: true
              supportsReasoningEffort: true
              reasoningEffortMap:
                minimal: "low"
                low: "low"
                medium: "medium"
                high: "xhigh"
                xhigh: "xhigh"
                max: "xhigh"
              requiresReasoningContentForToolCalls: false
              reasoningContentField: "reasoning_content"
              extraBody:
                temperature: 0.7
                top_p: 0.80
                top_k: 20
                min_p: 0.0
                presence_penalty: 1.5
                repetition_penalty: 1.0
                chat_template_kwargs:
                  enable_thinking: false
              whenThinking:
                extraBody:
                  temperature: 1.0
                  top_p: 0.95
                  top_k: 20
                  min_p: 0.0
                  presence_penalty: 0.0
                  repetition_penalty: 1.0
                  chat_template_kwargs:
                    enable_thinking: true
                    preserve_thinking: true

          # --- Qwen 3.6 (35B-A3B) Worker Model (HauhauCS Uncensored, NVFP4) ---
          # Official recommendations (https://huggingface.co/Qwen/Qwen3.6-35B-A3B):
          #   Thinking mode (default on):
          #     - General:            temp 1.0, top_p 0.95, top_k 20, min_p 0.0, presence_penalty 1.5
          #     - Coding/precise:     temp 0.6, top_p 0.95, top_k 20, min_p 0.0, presence_penalty 0.0 (configured for worker)
          #   Non-thinking mode:
          #     - General:            temp 0.7, top_p 0.80, top_k 20, min_p 0.0, presence_penalty 1.5
          #     - Reasoning tasks:    temp 1.0, top_p 1.00, top_k 40, min_p 0.0, presence_penalty 2.0
          #   Reasoning effort: Not defined/supported for Qwen 3.6 (binary thinking only)
          #   preserve_thinking: keeps historical thinking traces in context for agent scenarios
          # Multimodal MoE worker: 35B total / 3B active. Mapped to the `task` role (subagent workers).
          # vLLM backend: --max-model-len 100000 --max-num-seqs 6 --max-num-batched-tokens 8192
          #               --quantization compressed-tensors --kv-cache-dtype fp8
          #               --enable-auto-tool-choice --tool-call-parser qwen3_coder
          #               --reasoning-parser qwen3 (thinking + non-thinking modes)
          - id: "qwen3.6-35b"
            name: "Qwen 3.6 (35B-A3B) Worker"
            reasoning: true
            input: ["text", "image"]
            contextWindow: 100000
            maxTokens: 32768
            compat:
              supportsReasoningEffort: false
              thinkingFormat: "qwen-chat-template"
              requiresReasoningContentForToolCalls: false
              reasoningContentField: "reasoning_content"
              extraBody:
                temperature: 0.7
                top_p: 0.80
                top_k: 20
                min_p: 0.0
                presence_penalty: 1.5
                repetition_penalty: 1.0
                chat_template_kwargs:
                  enable_thinking: false
              whenThinking:
                extraBody:
                  temperature: 0.6
                  top_p: 0.95
                  top_k: 20
                  min_p: 0.0
                  presence_penalty: 0.0
                  repetition_penalty: 1.0
                  chat_template_kwargs:
                    enable_thinking: true
                    preserve_thinking: true

          # --- Qwen3 Coder (4B) Lightweight Model ---
          # Official recommendations (https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507):
          #   Sampling parameters: temp 0.7, top_p 0.80, top_k 20, min_p 0.0, presence_penalty 1.5
          #   Instruct-only (non-thinking model; reasoning effort not supported)
          - id: "qwen3-coder-4b"
            name: "Qwen3 Coder (4B)"
            reasoning: false
            input: ["text", "image"]
            contextWindow: 48000
            maxTokens: 8192
            compat:
              supportsReasoningEffort: false
              extraBody:
                temperature: 0.7
                top_p: 0.80
                top_k: 20
                min_p: 0.0
                presence_penalty: 1.5
                repetition_penalty: 1.0
                chat_template_kwargs:
                  enable_thinking: false
    ```
-   **`~/.omp/agent/config.yml`**: Contains global role mappings and LSP settings.

### 2. Repository-Level Configuration (Project Level)

To maintain consistency across team members or ensure your model setup lives directly in version control rather than user-specific directories, configure models at the repository level inside the `.omp/` folder of your project root. The project-level `.omp/` configuration in this image **mirrors the user-level configuration** so both stay in sync.

#### Setup Instructions for a Freshly Initialized Repository:

1. **Ensure `.omp` directory exists**:
   ```bash
   mkdir -p .omp
   ```
   *(Note: If you run `bootstrap.sh`, `.omp/` will already be created.)*

2. **Define Models in `.omp/models.yml`**:
   Create `.omp/models.yml` in your repository root pointing to your LiteLLM instance (or any OpenAI-compatible gateway such as `http://spark.orca-hue.ts.net:4000/v1`):

   ```yaml
   # .omp/models.yml — identical to the user-level models.yml; see section 1.
   providers:
     litellm:
       api: openai-completions
       baseUrl: "http://spark.orca-hue.ts.net:4000/v1"
       apiKey: "anything"
       models:
         - id: "qwen3.8-27b"
           name: "Qwen 3.8 (27B)"
           reasoning: true
           input: ["text", "image"]
           contextWindow: 230000
           maxTokens: 16384
           thinking:
             mode: effort
             efforts: ["low", "medium", "xhigh"]
             defaultLevel: xhigh
           compat:
             thinkingFormat: "qwen-chat-template"
             qwenTemplateReasoningEffort: true
             supportsReasoningEffort: true
             reasoningEffortMap:
               minimal: "low"
               low: "low"
               medium: "medium"
               high: "xhigh"
               xhigh: "xhigh"
               max: "xhigh"
             requiresReasoningContentForToolCalls: false
             reasoningContentField: "reasoning_content"
             extraBody:
               temperature: 0.7
               top_p: 0.80
               top_k: 20
               min_p: 0.0
               presence_penalty: 1.5
               repetition_penalty: 1.0
               chat_template_kwargs:
                 enable_thinking: false
             whenThinking:
               extraBody:
                 temperature: 1.0
                 top_p: 0.95
                 top_k: 20
                 min_p: 0.0
                 presence_penalty: 0.0
                 repetition_penalty: 1.0
                 chat_template_kwargs:
                   enable_thinking: true
                   preserve_thinking: true
         - id: "qwen3.6-35b"
           name: "Qwen 3.6 (35B-A3B) Worker"
           reasoning: true
           input: ["text", "image"]
           contextWindow: 100000
           maxTokens: 32768
           compat:
             supportsReasoningEffort: false
             thinkingFormat: "qwen-chat-template"
             requiresReasoningContentForToolCalls: false
             reasoningContentField: "reasoning_content"
             extraBody:
               temperature: 0.7
               top_p: 0.80
               top_k: 20
               min_p: 0.0
               presence_penalty: 1.5
               repetition_penalty: 1.0
               chat_template_kwargs:
                 enable_thinking: false
             whenThinking:
               extraBody:
                 temperature: 0.6
                 top_p: 0.95
                 top_k: 20
                 min_p: 0.0
                 presence_penalty: 0.0
                 repetition_penalty: 1.0
                 chat_template_kwargs:
                   enable_thinking: true
                   preserve_thinking: true
         - id: "qwen3-coder-4b"
           name: "Qwen3 Coder (4B)"
           reasoning: false
           input: ["text", "image"]
           contextWindow: 48000
           maxTokens: 8192
           compat:
             supportsReasoningEffort: false
             extraBody:
               temperature: 0.7
               top_p: 0.80
               top_k: 20
               min_p: 0.0
               presence_penalty: 1.5
               repetition_penalty: 1.0
               chat_template_kwargs:
                 enable_thinking: false
   ```

3. **Map Roles in `.omp/config.yml`**:
   Assign the defined models to native `omp` roles in `.omp/config.yml`:

   ```yaml
   # .omp/config.yml
   defaultThinkingLevel: "xhigh"

   modelRoles:
     default: "litellm/qwen3.8-27b"
     smol: "litellm/qwen3-coder-4b"
     slow: "litellm/qwen3.8-27b"
     plan: "litellm/qwen3.8-27b"
     task: "litellm/qwen3.6-35b"     # Worker model: strong coder/specialist given detailed instructions
     memory: "litellm/qwen3-coder-4b"
     tiny: "litellm/qwen3-coder-4b"

  # Retry / Fallback Chains — model-oriented keys apply to every role running
  # that model (default/slow/plan → 35B worker → 4B; task → 4B). Applied on
  # provider errors; chains end at the last online link (session-side tasks
  # keep running on-device via the tiny-model providers below).
  retry:
    fallbackChains:
      "litellm/qwen3.8-27b":
        - "litellm/qwen3.6-35b"
        - "litellm/qwen3-coder-4b"
      "litellm/qwen3.6-35b":
        - "litellm/qwen3-coder-4b"
      "litellm/qwen3-coder-4b": []

   # Local Tiny-Model Providers (Task-specific overrides)
   # Side tasks run on the baked-in local model lfm2-1.2b (offline-resilient
   # fallback for the small online models). "online" routes through the
   # role-mapped online model instead.
   providers:
     tinyModel: "lfm2-1.2b"
     memoryModel: "lfm2-1.2b"
     autoThinkingModel: "lfm2-1.2b"
     tinyModelDevice: "cpu"     # cpu (default), gpu, auto, metal, cuda, dml
     tinyModelDtype: "q4"       # q4 (default), fp16

   # Subagent Concurrency & Parallelism
   subagents:
     globalConcurrencyLimit: 20    # Combined limit (2 big + 18 small sessions)
     maxSubagentDepth: 2
     forceTopLevelAsync: true
     parallel:
       concurrency: 2              # 'big' model slots (qwen3.8 --max-num-seqs 2)
   ```

4. **Verify Discovery**:
   omp reads model definitions **only** from `~/.omp/agent/models.yml` — maintained by `seed-omp-home.sh` as a pointer to this workspace's `.omp/models.yml` — and merges `.omp/config.yml` over user-level settings. An explicit `providers.<id>.baseUrl` in that file outranks `LITELLM_BASE_URL` and the built-in `http://localhost:4000/v1` default.

---

### 3. Native Model Roles & LiteLLM Role Mapping

The following native roles are used by the `omp` harness and mapped to the LiteLLM models:

| Role | Purpose | Default Local Mapping | LiteLLM Setup Mapping | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `default` | Primary model for interactive chat and coding. | `local/qwen3-coder:32b` | `litellm/qwen3.8-27b` | High capability for general instruction, agentic reasoning and code generation. Retries on `litellm/qwen3.6-35b`, then `litellm/qwen3-coder-4b` (retry chain). |
| `smol` | Fast, lightweight model for background tasks (summaries, titles). | `local/qwen3-coder:7b` | `litellm/qwen3-coder-4b` | Fast response times and low latency for utility tasks. Chain-terminating model (no further fallback). |
| `slow` | Heavy reasoning model for complex architectural problems. | `local/deepseek-r1:70b` | `litellm/qwen3.8-27b` | Maximum capability available for complex problem-solving. Retries on `litellm/qwen3.6-35b`, then `litellm/qwen3-coder-4b` (retry chain). |
| `plan` | Architect model used for planning work in plan mode. | `local/deepseek-r1:70b` | `litellm/qwen3.8-27b` | Strong structured output and planning ability. Retries on `litellm/qwen3.6-35b`, then `litellm/qwen3-coder-4b` (retry chain). |
| `task` | Model used for executing delegated subagent tasks. | `local/qwen3-coder:32b` | `litellm/qwen3.6-35b` | **Worker model**: 35B-A3B MoE (3B active) — a very capable coder/specialist given detailed instructions; slightly less agentic reasoning than Qwen 3.8. Serves `--max-num-seqs 6` for parallel subagents. Retries on `litellm/qwen3-coder-4b` (retry chain). |
| `memory` | Model used for Hindsight / memory extraction (online fallback). | `local/qwen3-coder:7b` | `litellm/qwen3-coder-4b` | Quick extraction of semantic observations into memory. Chain-terminating model (no further fallback). |
| `tiny` | Role fallback when task-specific `tinyModel` is set to `online`. | `local/qwen3-coder:7b` | `litellm/qwen3-coder-4b` | Low latency fallback for session titles and background tasks. Chain-terminating model (no further fallback). |

**Fallback chains (`retry.fallbackChains`)**: defined in `.omp/config.yml` (the settings store is built only from `config.yml` files — a `retry` key in `models.yml` is not read). Model-oriented keys apply whenever that model is active, regardless of role. The baked defaults chain `litellm/qwen3.8-27b → litellm/qwen3.6-35b → litellm/qwen3-coder-4b` and `litellm/qwen3.6-35b → litellm/qwen3-coder-4b`, so every role backed by the Qwen 3.8 or 3.6 models automatically retries down the chain after provider errors, ending at the 4B model. The true offline path for the small models is the on-device `lfm2-1.2b` local model (next section).

### 4. Local Tiny Models (On-Device Inference)

`oh-my-pi` supports running task-specific tiny models directly on device via `@huggingface/transformers` (Transformers.js ONNX runtime under Bun) on CPU without GPU requirements.

The minimum footprint models are **pre-baked and shipped directly inside the devcontainer image** (via `omp tiny-models download` in the Dockerfile), eliminating first-run downloads and latency: **`gemma-270m`, `lfm2-350m`, `lfm2-1.2b`**.

| Task Setting | Purpose | Minimum Footprint Option | Shipped Local Options |
| :--- | :--- | :--- | :--- |
| `providers.tinyModel` | Fast session title generation | `gemma-270m` (~150MB) or `lfm2-350m` (~212MB q4) | `gemma-270m`, `lfm2-350m`, `lfm2-1.2b` (baked) + `qwen3-0.6b`, `qwen2.5-0.5b`, `lfm2-700m` (downloadable) |
| `providers.memoryModel` | Mnemopi extraction & consolidation | `lfm2-1.2b` (~700MB q4) | `lfm2-1.2b` (baked, recommended) + `qwen2.5-1.5b`, `gemma-3-1b`, `llama3.2:3b` (downloadable) |
| `providers.autoThinkingModel` | Dynamic thinking difficulty classification | `lfm2-1.2b` (~700MB q4) | `lfm2-1.2b` (baked, recommended) + `qwen2.5-1.5b`, `gemma-3-1b`, `llama3.2:3b` (downloadable) |

#### Configuration:
- Set any setting to `"online"` to use the online role mappings (`modelRoles.tiny`, `modelRoles.memory`, `modelRoles.smol`).
- Set to a local model name (e.g. `tinyModel: "lfm2-350m"`, `memoryModel: "lfm2-1.2b"`) to run on device.
- Device and precision controls: `tinyModelDevice: "cpu"` (default) and `tinyModelDtype: "q4"` (default).
- **Baked default: `lfm2-1.2b` for all three task providers** — the most capable of the pre-baked local models and the fastest warm load (~0.4s). This makes the small online models (smol / `qwen3-coder-4b`) effectively fall back to the local model: titles, memory extraction/consolidation and auto-thinking run fully on-device with no network dependency.

*(Note: `qwen3-1.7b` ONNX currently has unsupported RotaryEmbedding cache updates in `onnxruntime-node`; use `lfm2-1.2b` or `qwen2.5-1.5b` instead.)*

### 5. Preferred Local Models (128GB GB10)

For high-end local setups (e.g., NVIDIA GB10 with 128GB VRAM), we recommend the following 2026-era models for optimal performance and reasoning:

| Role Type | Recommended Model | Quantization | VRAM Fit | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Heavy Reasoning** | `deepseek-r1:70b` | Q4_K_M | ~40 GB | Best for `plan` and `slow` roles. |
| **General Coding** | `qwen3-coder:32b` | Q4_K_M | ~20 GB | Best for `default` and `task` roles. |
| **Fast Utility** | `qwen3-coder:7b` | Q4_K_M | ~5 GB | Best for `smol` and `memory` roles. |

### 5. Managing Parallelism

Running multiple subagents concurrently can quickly exhaust VRAM. The base image is configured to balance high-concurrency with stability by default. The engine-level concurrency caps come from the vLLM `--max-num-seqs` flags:

- **qwen3.8-27b** (big models: `default`/`slow`/`plan`): `--max-model-len 230000`, `--max-num-seqs 2`, `--max-num-batched-tokens 32768`
- **qwen3.6-35b worker** (`task` role): `--max-model-len 100000`, `--max-num-seqs 6`, `--max-num-batched-tokens 8192`

The harness limits are tuned to match:

- **Global Limit**: `globalConcurrencyLimit: 20` (Total simultaneous subagent sessions).
- **Big Model Slots**: `parallel.concurrency: 2` (matches qwen3.8 `--max-num-seqs 2`).
- **Small Model Slots**: `18` (remaining slots for `smol`/`task` models; the worker engine caps concurrency at 6 sequences and queues the overflow).

To adjust these limits, edit `~/.omp/agent/config.yml`:

```yaml
subagents:
  globalConcurrencyLimit: 20
  parallel:
    concurrency: 2
```

## Model ↔ Agent Mapping

- **`@task` / `@smol` agents** (worker model): MUST NOT specify effort in their body — the Qwen3.6 A3B worker uses **binary thinking only**. Effort keywords (`ultrathink`, `medium`, etc.) are no-ops in agent bodies for these roles.
- **`@slow` / `@plan` agents** (primary model): use `low|medium|xhigh` effort levels as configured in `models.yml` and `config.yml`.

Frontmatter `thinking-level` is safe on all roles (the harness clamps rather than errors). Agent body effort keywords are the distinction: omit them for `@task`/`@smol`-mapped agents.
