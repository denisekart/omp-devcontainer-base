# omp-devcontainer-base

A portable, workspace-independent devcontainer base image designed for the [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`/`pi`) AI coding harness.

## 🚀 Overview

This repository provides a "Base Image Factory" for creating a consistent development environment across multiple projects. It bundles a full .NET 10/Aspire + SvelteKit + Python toolchain with a pre-configured `oh-my-pi` agent environment.

### Key Features
- **Workspace Independence**: Use the same image for any repository.
- **Baked-in Capabilities**: Agents and skills are baked into the image, reducing workspace pollution.
- **Persistent State**: LLM settings, memory (Hindsight), and history are shared and persisted across all your projects via Docker volumes.
- **Native omp Integration**: Fully leverages native `omp` features like `task` delegation, `recall`/`store` memory, and session continuation.

---

## 🛠️ Internal Architecture

### 1. Build Context (`build/`)
The `build/` directory is the source of truth for the image. It is isolated from the rest of the repository to keep the Docker build context lean.
- **`Dockerfile`**: Sets up the OS, toolchains, and `oh-my-pi` environment.
- **`library/omp-defaults/`**: Contains the default `config.yml`, `models.yml`, `agents/`, and `skills/`. These are "baked" into `/usr/local/share/omp-defaults/`.
- **`scripts/`**: Setup and lifecycle scripts baked into `/usr/local/share/omp-scripts/`.

### 2. First-Boot Seeding
When the container starts for the first time, `seed-omp-home.sh` copies the baked-in defaults from `/usr/local/share/omp-defaults/` to the user's persistent volume at `~/.omp/`. 
- This ensures you have a working configuration immediately.
- Because `~/.omp` is a persistent volume, your customizations (like `models.yml`) survive container rebuilds.

### 3. Workspace Bootstrapping
`bootstrap.sh` runs automatically during the `postCreateCommand` to specialize the current workspace for `omp`. It creates:
- `AGENTS.md`: The context file `omp` uses to understand your project.
- `.omp/config.yml`: Project-level overrides (e.g., stack definitions).
- `.omp/plans/`: Directory for agent-generated work plans.

### 4. Named Profiles
`oh-my-pi` supports named profiles to isolate user-level configuration (MCPs, skills, agents).
- **Global Profile**: Uses `~/.omp/agent/`.
- **Named Profile**: Uses `~/.omp/profiles/<name>/agent/`.

Start a session with a profile:
```bash
omp --profile work
```
Profiles share project-level configuration (`.omp/`), but keep their own model history, memory, and user-level tool settings.

---

## 🏗️ Building and Publishing

### Build the Image
The image is built for both `linux/amd64` and `linux/arm64` via GitHub Actions. To build it manually for multiple architectures:
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/denisekart/omp-devcontainer-base:latest -f build/Dockerfile build/ --push
```

### Publish the Image
Publication is handled automatically by the [GitHub Workflow](#-github-workflow) when a tag is pushed.

---

## 📦 Integrating into Your Project

To add `oh-my-pi` support to any repository:

1. **Add the Devcontainer Config**:
   Create a `.devcontainer/devcontainer.json` in your target repository pointing to the pre-built image:
   ```json
   {
     "name": "my-omp-project",
     "image": "ghcr.io/denisekart/omp-devcontainer-base:latest",
     "mounts": [
       "source=omp-home,target=/home/vscode/.omp,type=volume",
       "source=hindsight-data,target=/home/vscode/.hindsight,type=volume"
     ],
     "postCreateCommand": "bash /usr/local/share/omp-scripts/bootstrap.sh"
   }
   ```
   *(Note: The base image includes all necessary setup scripts and defaults. See [Persistence](#-persistence) for recommended volume mounts.)*

2. **Open in Container**:
   Open your target repo in VS Code and run **Dev Containers: Reopen in Container**.

3. **Initialize the Workspace**:
   Bootstrapping is performed automatically on container creation. If you need to re-run it (e.g., to change the stack preset), you can run:
   ```bash
   bash /usr/local/share/omp-scripts/bootstrap.sh --stack <preset>
   ```

4. **Configure your Models**:
   Configure models at either the **repository level** (recommended so configurations are committed and shared with the workspace) or the **user level** (`~/.omp/agent/`):
   - **Repository Level**: Define endpoints in `.omp/models.yml` and role mappings in `.omp/config.yml`.
   - **User Level**: Edit `~/.omp/agent/models.yml` and `~/.omp/agent/config.yml`.
   See [Model Configuration & Roles](#-model-configuration--roles) below for complete step-by-step instructions (including LiteLLM / custom OpenAI-compatible proxies).

5. **Start Coding**:
   Run `omp` to start your first session.

---

## 🧠 Model Configuration & Roles

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
            input: ["text"]
            contextWindow: 131072
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
                chat_template_kwargs:
                  enable_thinking: true
          - id: "qwen3-coder-4b"
            name: "Qwen3 Coder (4B)"
            reasoning: false
            input: ["text"]
            contextWindow: 32768
            maxTokens: 8192
            compat:
              supportsReasoningEffort: false
              extraBody:
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
           input: ["text"]
           contextWindow: 131072
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
               chat_template_kwargs:
                 enable_thinking: true
         - id: "qwen3-coder-4b"
           name: "Qwen3 Coder (4B)"
           reasoning: false
           input: ["text"]
           contextWindow: 32768
           maxTokens: 8192
           compat:
             supportsReasoningEffort: false
             extraBody:
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

---

## 🔌 Tooling & MCP (Model Context Protocol)

`oh-my-pi` uses MCP to connect agents to external tools (git, filesystem, databases, etc.).

### 1. Configuration Layers
- **Global Tooling (`~/.omp/agent/mcp.json`)**: Contains core servers baked into the image (`git`, `fetch`, `filesystem`, `time`, `codegraph`).
- **Project Tooling (`.omp/mcp.json`)**: Contains stack-specific servers (e.g., `docker`, `aspire`, `shadcn`) generated by `bootstrap.sh`.

### 2. Precedence & Discovery
- **Project > User**: If a server name exists in both project and user config, the **project-level definition wins**.
- **No Merging**: Duplicate server names are NOT merged. The first one discovered (project first) is used, and the others are ignored for that name.
- **Independence**: Different-named servers from both files are combined. You don't need to redefine core servers in your project if you only want to add new ones.

---

## 🤖 Agents and Skills

### Included Agents
- **`plan` (Prometheus)**: High-level architect. Scans the project, creates `.omp/plans/`, and delegates to specialists.
- **`backend-expert`**: Senior .NET engineer.
- **`frontend-expert`**: Senior Svelte/Web engineer.
- **`quality-assurance`**: SDET focused on xUnit and Playwright.

### Included Skills
- **`plan-workflow`**: Governs the draft -> review -> approve -> execute cycle.
- **`scaffold-workspace`**: Provides the `/scaffold` slash command to generate project structures.
- **`handoff`**: Manages state transitions via native `/continue` and `task` blocks.

---

## 💾 Persistence

Named Docker volumes ensure your data survives:
- `~/.omp`: Agent configuration and session history.
- `~/.hindsight`: Memory server data.
- `~/.ssh`: SSH keys.
- `~/.nuget`, `~/.local/share/pnpm`: Package caches.

---

## 🔍 Troubleshooting

- **Hindsight Memory**: Check status with `curl http://localhost:8888/health`. Logs are at `~/.hindsight/hindsight.log`.
- **Reset Defaults**: To restore original image settings, `rm ~/.omp/.seeded-v1` and restart the container.
- **Models**: If agents can't connect, verify the `baseUrl` in `~/.omp/agent/models.yml` is reachable from inside the container (use `host.docker.internal` for host-hosted LLMs).
