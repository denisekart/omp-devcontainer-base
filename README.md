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
From the root of this repository:
```bash
docker build -t your-registry/omp-devcontainer-base:latest -f build/Dockerfile build/
```

### Publish the Image
```bash
docker push your-registry/omp-devcontainer-base:latest
```

---

## 📦 Integrating into Your Project

To add `oh-my-pi` support to any repository:

1. **Copy the Devcontainer Setup**:
   Copy the `.devcontainer/` folder from this repo to your target repo.
   
2. **Open in Container**:
   Open your target repo in VS Code and run **Dev Containers: Reopen in Container**.

3. **Initialize the Workspace**:
   Bootstrapping is performed automatically on container creation. If you need to re-run it (e.g., to change the stack preset), you can run:
   ```bash
   bash /usr/local/share/omp-scripts/bootstrap.sh --stack <preset>
   ```

4. **Configure your Models**:
   Edit `~/.omp/agent/models.yml` to define your LLM endpoints and `~/.omp/agent/config.yml` to map them to roles. See [Model Configuration](#-model-configuration--roles) below.

5. **Start Coding**:
   Run `omp` to start your first session.

---

## 🧠 Model Configuration & Roles

`oh-my-pi` uses a two-tier configuration system to manage LLMs:

1.  **Definitions (`models.yml`)**: Defines *where* the models are (endpoints, API keys, APIs).
2.  **Mappings (`config.yml`)**: Assigns those defined models to specific **roles** (capabilities) used by the agent.

### 1. Global Configuration (User Level)

The base image seeds default configurations into your user home directory:

-   **`~/.omp/agent/models.yml`**: Contains provider definitions. By default, it uses local models via Ollama.
    ```yaml
    providers:
      local:
        api: openai-completions
        baseUrl: "http://host.docker.internal:11434/v1"
        auth: none
        models:
          qwen2.5-coder:7b:
            id: "qwen2.5-coder:7b"
          deepseek-r1:32b:
            id: "deepseek-r1:32b"
    ```
-   **`~/.omp/agent/config.yml`**: Contains global role mappings and LSP settings.

### 2. Project Overrides

You can specialize model selection for a specific project by editing `.omp/config.yml` in your project root. Overrides at the project level take precedence over global settings.

```yaml
# .omp/config.yml
modelRoles:
  plan: "openai/gpt-4o" # Use a cloud model for planning in this specific project
```

### 3. Native Model Roles

The following roles are used by the `omp` harness:

| Role | Purpose | Default Mapping |
| :--- | :--- | :--- |
| `default` | Primary model for interaction and chat. | `local/qwen2.5-coder:7b` |
| `smol` | Fast model for background tasks (summaries, titles). | `local/qwen2.5-coder:7b` |
| `slow` | Heavy reasoning model for complex architecture. | `local/deepseek-r1:32b` |
| `plan` | Architect model used for creating work plans. | `local/deepseek-r1:32b` |
| `task` | Model used for executing delegated sub-tasks. | `local/qwen2.5-coder:7b` |
| `memory` | Model used for Hindsight context extraction. | `local/qwen2.5-coder:7b` |

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
