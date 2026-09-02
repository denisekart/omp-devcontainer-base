# Model Configuration & Roles

## Important for external users

The image seeds a default `models.yml` whose `baseUrl` is **the image author's** LiteLLM endpoint (`http://spark.orca-hue.ts.net:4000/v1`). It will not be reachable from your machine.

You **MUST** point `models.yml` at your own OpenAI-compatible endpoint (LiteLLM or any OpenAI-compatible gateway):

- Edit the user-level `~/.omp/agent/models.yml`, or (recommended) the repository-level `.omp/models.yml` so the configuration is committed and shared with your team.
- For LLM servers running on the host machine, use `http://host.docker.internal:<port>/v1` as the `baseUrl` — inside the container, `localhost` refers to the container itself.

This is the single most common onboarding failure; it is also covered in [getting-started.md](getting-started.md) (section 5) and [troubleshooting.md](troubleshooting.md).


`oh-my-pi` uses a two-tier configuration system to manage LLMs:

1.  **Definitions (`models.yml`)**: Defines *where* the models are (endpoints, API keys, APIs).
2.  **Mappings (`config.yml`)**: Assigns those defined models to specific **roles** (capabilities) used by the agent.

### 1. Global Configuration (User Level)

The base image seeds default configurations into your user home directory:

-   **`~/.omp/agent/models.yml`**: Contains provider definitions. By default, it connects to LiteLLM serving Qwen models with reasoning controls.
    ```yaml
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
            contextWindow: 200000
            maxTokens: 16384
            thinking:
              mode: effort
              minLevel: low
              maxLevel: xhigh
            compat:
              thinkingFormat: "qwen-chat-template"
              qwenTemplateReasoningEffort: true
              supportsReasoningEffort: true
              reasoningEffortMap:
                minimal: "low"
                low: "low"
                medium: "medium"
                high: "high"
                xhigh: "high"
              requiresReasoningContentForToolCalls: true
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

To maintain consistency across team members or ensure your model setup lives directly in version control rather than user-specific directories, configure models at the repository level inside the `.omp/` folder of your project root.

#### Setup Instructions for a Freshly Initialized Repository:

1. **Ensure `.omp` directory exists**:
   ```bash
   mkdir -p .omp
   ```
   *(Note: If you run `bootstrap.sh`, `.omp/` will already be created.)*

2. **Define Models in `.omp/models.yml`**:
   Create `.omp/models.yml` in your repository root pointing to your LiteLLM instance (or any OpenAI-compatible gateway such as `http://spark.orca-hue.ts.net:4000/v1`):

   ```yaml
   # .omp/models.yml
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
           contextWindow: 200000
           maxTokens: 16384
           thinking:
             mode: effort
             minLevel: low
             maxLevel: xhigh
           compat:
             thinkingFormat: "qwen-chat-template"
             qwenTemplateReasoningEffort: true
             supportsReasoningEffort: true
             reasoningEffortMap:
               minimal: "low"
               low: "low"
               medium: "medium"
               high: "high"
               xhigh: "high"
             requiresReasoningContentForToolCalls: true
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
   modelRoles:
     default: "litellm/qwen3.8-27b"
     smol: "litellm/qwen3-coder-4b"
     slow: "litellm/qwen3.8-27b"
     plan: "litellm/qwen3.8-27b"
     task: "litellm/qwen3.8-27b"
     memory: "litellm/qwen3-coder-4b"
     tiny: "litellm/qwen3-coder-4b"

   # Local Tiny-Model Providers (Task-specific overrides)
   # Set to 'online' to use role-mapped models, or specify a local tiny model.
   providers:
     tinyModel: "online"        # e.g., "gemma-270m" or "lfm2-350m" (minimum footprint)
     memoryModel: "online"      # e.g., "lfm2-1.2b" (recommended) or "qwen2.5-1.5b"
     autoThinkingModel: "online" # e.g., "lfm2-1.2b"
     tinyModelDevice: "cpu"     # cpu (default), gpu, auto, metal, cuda, dml
     tinyModelDtype: "q4"       # q4 (default), fp16
   ```

4. **Verify Discovery**:
   When launching `omp`, the agent automatically merges `.omp/models.yml` and `.omp/config.yml` over user-level configurations.

---

### 3. Native Model Roles & LiteLLM Role Mapping

The following native roles are used by the `omp` harness and mapped to the LiteLLM models:

| Role | Purpose | Default Local Mapping | LiteLLM Setup Mapping | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `default` | Primary model for interactive chat and coding. | `local/qwen3-coder:32b` | `litellm/qwen3.8-27b` | High capability for general instruction and code generation. |
| `smol` | Fast, lightweight model for background tasks (summaries, titles). | `local/qwen3-coder:7b` | `litellm/qwen3-coder-4b` | Fast response times and low latency for utility tasks. |
| `slow` | Heavy reasoning model for complex architectural problems. | `local/deepseek-r1:70b` | `litellm/qwen3.8-27b` | Maximum capability available for complex problem-solving. |
| `plan` | Architect model used for planning and generating `.omp/plans/`. | `local/deepseek-r1:70b` | `litellm/qwen3.8-27b` | Strong structured output and planning ability. |
| `task` | Model used for executing delegated subagent tasks. | `local/qwen3-coder:32b` | `litellm/qwen3.8-27b` | Capable code generation for subagent work items. |
| `memory` | Model used for Hindsight / memory extraction (online fallback). | `local/qwen3-coder:7b` | `litellm/qwen3-coder-4b` | Quick extraction of semantic observations into memory. |
| `tiny` | Role fallback when task-specific `tinyModel` is set to `online`. | `local/qwen3-coder:7b` | `litellm/qwen3-coder-4b` | Low latency fallback for session titles and background tasks. |

### 4. Local Tiny Models (On-Device Inference)

`oh-my-pi` supports running task-specific tiny models directly on device via `@huggingface/transformers` (Transformers.js ONNX runtime under Bun) on CPU without GPU requirements.

The minimum footprint models are **pre-baked and shipped directly inside the devcontainer image**, eliminating first-run downloads and latency:

| Task Setting | Purpose | Minimum Footprint Option | Shipped Local Options |
| :--- | :--- | :--- | :--- |
| `providers.tinyModel` | Fast session title generation | `gemma-270m` (~150MB) or `lfm2-350m` (~212MB q4) | `gemma-270m`, `lfm2-350m`, `qwen3-0.6b`, `qwen2.5-0.5b`, `lfm2-700m` |
| `providers.memoryModel` | Mnemopi extraction & consolidation | `lfm2-1.2b` (~700MB q4) | `lfm2-1.2b` (recommended), `qwen2.5-1.5b`, `gemma-3-1b`, `llama3.2:3b` |
| `providers.autoThinkingModel` | Dynamic thinking difficulty classification | `lfm2-1.2b` (~700MB q4) | `lfm2-1.2b` (recommended), `qwen2.5-1.5b`, `gemma-3-1b`, `llama3.2:3b` |

#### Configuration:
- Set any setting to `"online"` to use the online role mappings (`modelRoles.tiny`, `modelRoles.memory`, `modelRoles.smol`).
- Set to a local model name (e.g. `tinyModel: "gemma-270m"`, `memoryModel: "lfm2-1.2b"`) to run on device.
- Device and precision controls: `tinyModelDevice: "cpu"` (default) and `tinyModelDtype: "q4"` (default).

*(Note: `qwen3-1.7b` ONNX currently has unsupported RotaryEmbedding cache updates in `onnxruntime-node`; use `lfm2-1.2b` or `qwen2.5-1.5b` instead.)*

### 5. Preferred Local Models (128GB GB10)

For high-end local setups (e.g., NVIDIA GB10 with 128GB VRAM), we recommend the following 2026-era models for optimal performance and reasoning:

| Role Type | Recommended Model | Quantization | VRAM Fit | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Heavy Reasoning** | `deepseek-r1:70b` | Q4_K_M | ~40 GB | Best for `plan` and `slow` roles. |
| **General Coding** | `qwen3-coder:32b` | Q4_K_M | ~20 GB | Best for `default` and `task` roles. |
| **Fast Utility** | `qwen3-coder:7b` | Q4_K_M | ~5 GB | Best for `smol` and `memory` roles. |

### 5. Managing Parallelism

Running multiple subagents concurrently can quickly exhaust VRAM. The base image is configured to balance high-concurrency with stability by default:

- **Global Limit**: `globalConcurrencyLimit: 20` (Total simultaneous subagent sessions).
- **Big Model Slots**: `parallel.concurrency: 4` (Recommended max for `slow`/`plan` models).
- **Small Model Slots**: `16` (Remaining slots for `smol`/`task` models).

To adjust these limits, edit `~/.omp/agent/config.yml`:

```yaml
subagents:
  globalConcurrencyLimit: 20
  parallel:
    concurrency: 4
```
