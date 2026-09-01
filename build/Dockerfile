FROM mcr.microsoft.com/devcontainers/base:bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV DOTNET_ROOT=/usr/share/dotnet
ENV BUN_INSTALL=/usr/local
ENV PATH=$BUN_INSTALL/bin:$DOTNET_ROOT:/home/vscode/.dotnet/tools:/home/vscode/.local/bin:/usr/local/bin:$PATH

# Install core packages and tooling
RUN apt-get update && apt-get -y install --no-install-recommends \
    wget \
    curl \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    git \
    jq \
    ripgrep \
    fd-find \
    fzf \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libssl-dev \
    pkg-config \
    zoxide \
    bat \
    unzip \
    procps \
    util-linux \
    libxext6 \
    libxrender1 \
    libxtst6 \
    libxi6 \
    libfreetype6 \
    xdg-utils \
    tmux \
    shellcheck \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install yq (YAML processor)
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64|arm64) yq_arch="$arch" ;; \
      *) yq_arch="amd64" ;; \
    esac; \
    wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${yq_arch}"; \
    chmod +x /usr/local/bin/yq

# Install eza (modern ls replacement)
RUN set -eux; \
    if apt-get update && apt-get install -y --no-install-recommends eza; then \
      :; \
    else \
      rm -rf /var/lib/apt/lists/*; \
      arch="$(dpkg --print-architecture)"; \
      case "$arch" in \
        amd64) eza_arch="x86_64" ;; \
        arm64) eza_arch="aarch64" ;; \
        *) eza_arch="x86_64" ;; \
      esac; \
      tmpdir="$(mktemp -d)"; \
      wget -qO "$tmpdir/eza.tar.gz" "https://github.com/eza-community/eza/releases/latest/download/eza_${eza_arch}-unknown-linux-gnu.tar.gz"; \
      tar -xzf "$tmpdir/eza.tar.gz" -C "$tmpdir"; \
      install -m 0755 "$(find "$tmpdir" -type f -name eza | head -n 1)" /usr/local/bin/eza; \
      rm -rf "$tmpdir"; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh

# Install .NET 10 SDK using official install script
RUN curl -sSL https://dotnet.microsoft.com/download/dotnet/scripts/v1/dotnet-install.sh | bash /dev/stdin --channel 10.0 --install-dir "$DOTNET_ROOT" \
    && ln -s "$DOTNET_ROOT/dotnet" /usr/local/bin/dotnet

# Install Aspire workload
RUN dotnet workload install aspire

# Install git-delta
RUN set -eux; \
    if apt-get update && apt-get install -y --no-install-recommends git-delta; then \
      :; \
    else \
      rm -rf /var/lib/apt/lists/*; \
      arch="$(dpkg --print-architecture)"; \
      case "$arch" in \
        amd64) delta_arch="amd64" ;; \
        arm64) delta_arch="arm64" ;; \
        *) delta_arch="amd64" ;; \
      esac; \
      tmpdir="$(mktemp -d)"; \
      url="$(curl -fsSL https://api.github.com/repos/dandavison/delta/releases/latest | jq -r --arg arch "$delta_arch" '.assets[] | select(.name | test("^git-delta_.*_" + $arch + "\\.deb$")) | .browser_download_url' | sed -n '1p')"; \
      wget -qO "$tmpdir/git-delta.deb" "$url"; \
      dpkg -i "$tmpdir/git-delta.deb" || apt-get -f install -y; \
      rm -rf "$tmpdir"; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# Install Starship prompt
RUN curl -sS https://starship.rs/install.sh | sh -s -- -y -b /usr/local/bin

# Install Node.js 24 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Update npm and install global npm tools
RUN npm install -g npm@latest \
    && npm install -g typescript pnpm typescript-language-server svelte-language-server vscode-langservers-extracted bash-language-server

# Install bun runtime
RUN curl -fsSL https://bun.sh/install | bash

# Install oh-my-pi globally using bun and create pi symlink
RUN bun install -g @oh-my-pi/pi-coding-agent@latest \
    && ln -sf /usr/local/bin/omp /usr/local/bin/pi \
    && node -e '\
const fs = require("fs");\
const path = require("path");\
function walk(dir) {\
  if (!fs.existsSync(dir)) return [];\
  let files = [];\
  try {\
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\
      const full = path.join(dir, entry.name);\
      if (entry.isDirectory()) files = files.concat(walk(full));\
      else files.push(full);\
    }\
  } catch (e) {}\
  return files;\
}\
for (const file of walk("/usr/local")) {\
  if (file.includes("legacy-pi-tui-shim")) {\
    let content = fs.readFileSync(file, "utf8");\
    if (!content.includes("stripTerminalSequences")) {\
      content += "\nexport function stripTerminalSequences(text) { return (text || \"\").replace(/\\x1B(?:\\[[0-?]*[ -/]*[@-~]|[@-Z\\\\-_])/g, \"\"); }\n";\
      fs.writeFileSync(file, content);\
      console.log("Patched stripTerminalSequences in", file);\
    }\
  }\
  if (file.includes("legacy-pi-ai-shim")) {\
    let content = fs.readFileSync(file, "utf8");\
    if (!content.includes("getSupportedThinkingLevels")) {\
      content += "\nexport function getSupportedThinkingLevels(model) { if (model && model.thinkingLevels && Array.isArray(model.thinkingLevels)) return model.thinkingLevels; if (model && model.thinkingLevelMap && typeof model.thinkingLevelMap === \"object\") return Object.keys(model.thinkingLevelMap); return [\"off\", \"low\", \"medium\", \"high\", \"xhigh\"]; }\nexport function clampThinkingLevel(model, level) { const s = getSupportedThinkingLevels(model); return s.includes(level) ? level : (s[0] || \"off\"); }\n";\
      fs.writeFileSync(file, content);\
      console.log("Patched getSupportedThinkingLevels in", file);\
    }\
  }\
}'

# Install Puppeteer apt dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxrandr2 \
    libxdamage1 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Install shell formatter
RUN arch="$(dpkg --print-architecture)" && \
    wget -qO /usr/local/bin/shfmt "https://github.com/mvdan/sh/releases/download/v3.13.1/shfmt_v3.13.1_linux_${arch}" && \
    chmod +x /usr/local/bin/shfmt

# Ensure vscode user belongs to docker group (required for DinD) and has passwordless sudo
RUN groupadd -f docker \
    && usermod -aG docker vscode \
    && usermod -aG sudo vscode \
    && echo "vscode ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vscode \
    && chmod 0440 /etc/sudoers.d/vscode

# Final environment setup
RUN apt-get update && apt-get install -y --no-install-recommends zsh iptables figlet \
    && chsh -s /usr/bin/zsh vscode \
    && rm -rf /var/lib/apt/lists/*

# Fix iptables permissions for Docker-in-Docker
RUN if [ -f /usr/sbin/iptables-legacy ]; then \
        update-alternatives --install /usr/sbin/iptables iptables /usr/sbin/iptables-legacy 10 \
        && update-alternatives --set iptables /usr/sbin/iptables-legacy; \
    fi && \
    if [ -f /usr/sbin/ip6tables-legacy ]; then \
        update-alternatives --install /usr/sbin/ip6tables ip6tables /usr/sbin/ip6tables-legacy 10 \
        && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy; \
    fi

USER root

# Baked omp defaults
COPY library/omp-defaults /usr/local/share/omp-defaults
RUN find /usr/local/share/omp-defaults -type f -exec sed -i 's/\r$//' {} + \
    && chown -R vscode:vscode /usr/local/share/omp-defaults

# Baked scripts
COPY scripts /usr/local/share/omp-scripts
RUN find /usr/local/share/omp-scripts -type f -exec sed -i 's/\r$//' {} + \
    && chown -R vscode:vscode /usr/local/share/omp-scripts \
    && chmod +x /usr/local/share/omp-scripts/*.sh

USER vscode

# User-level tools
RUN dotnet tool install -g dotnet-ef
RUN dotnet tool install -g Aspire.Cli --prerelease
RUN dotnet tool install -g csharp-ls
RUN uv tool install python-lsp-server
RUN uv tool install mcp-server-docker
RUN uv tool install mcp-server-fetch
RUN uv tool install mcp-server-git
RUN uv tool install mcp-server-time
RUN python3 -m venv ~/.local/share/hindsight \
    && ~/.local/share/hindsight/bin/pip install 'setuptools<58' wheel \
    && ~/.local/share/hindsight/bin/pip install hindsight-all hindsight-api \
    && ln -sf ~/.local/share/hindsight/bin/hindsight-api ~/.local/bin/hindsight-api \
    && ln -sf ~/.local/share/hindsight/bin/hindsight ~/.local/bin/hindsight 2>/dev/null || true

# Shell configuration
RUN mkdir -p ~/.zsh_history_dir \
    && printf '%s\n' 'export HISTFILE=~/.zsh_history_dir/.zsh_history' >> ~/.zshrc \
    && printf '%s\n' 'export HISTSIZE=10000' >> ~/.zshrc \
    && printf '%s\n' 'export SAVEHIST=10000' >> ~/.zshrc \
    && printf '%s\n' 'eval "$(starship init zsh)"' >> ~/.zshrc \
    && printf '%s\n' 'eval "$(zoxide init zsh)"' >> ~/.zshrc \
    && printf '%s\n' 'alias cat="batcat"' >> ~/.zshrc \
    && printf '%s\n' 'alias oc="omp"' >> ~/.zshrc \
    && printf '%s\n' 'alias fd="fdfind"' >> ~/.zshrc \
    && printf '%s\n' 'export BUN_INSTALL=/usr/local' >> ~/.zshrc \
    && printf '%s\n' 'export DOTNET_ROOT=/usr/share/dotnet' >> ~/.zshrc \
    && printf '%s\n' 'export PATH=$BUN_INSTALL/bin:$DOTNET_ROOT:/home/vscode/.dotnet/tools:/home/vscode/.local/bin:/usr/local/bin:$PATH' >> ~/.zshrc \
    && printf '%s\n' '' >> ~/.zshrc \
    && printf '%s\n' '# ── Prevent background job output from corrupting TUI displays ──────────' >> ~/.zshrc \
    && printf '%s\n' '# (omp, vim, htop, etc. all use alternate screen buffers; output' >> ~/.zshrc \
    && printf '%s\n' '#  from unsuppressed background jobs leaks through and pollutes the TUI)' >> ~/.zshrc \
    && printf '%s\n' 'setopt NO_MONITOR    # suppress "[n] done" job notifications' >> ~/.zshrc \
    && printf '%s\n' 'setopt BG_NICE       # nice background jobs (lower priority)' >> ~/.zshrc \
    && printf '%s\n' 'setopt NO_CHECK_JOBS # do not report stopped/exited jobs at prompt' >> ~/.zshrc \
    && printf '%s\n' '' >> ~/.zshrc \
    && printf '%s\n' '# Run a command in the background with stdout+stderr fully suppressed.' >> ~/.zshrc \
    && printf '%s\n' '# This is the ONLY safe way to background a long-running command.' >> ~/.zshrc \
    && printf '%s\n' '# Usage:  bgrun dotnet run --project src/App.AppHost' >> ~/.zshrc \
    && printf '%s\n' '#         bgrun tail -f /var/log/syslog' >> ~/.zshrc \
    && printf '%s\n' 'bgrun() {' >> ~/.zshrc \
    && printf '%s\n' '  local logfile="/tmp/bgrun-$$.log"' >> ~/.zshrc \
    && printf '%s\n' '  "$@" > "$logfile" 2>&1 &' >> ~/.zshrc \
    && printf '%s\n' '  disown' >> ~/.zshrc \
    && printf '%s\n' '  echo "Background: PID=$! log=$logfile"' >> ~/.zshrc \
    && printf '%s\n' '}' >> ~/.zshrc

# Configure tmux for agent use
RUN printf '%s\n' 'set -g default-terminal "screen-256color"' >> ~/.tmux.conf \
    && printf '%s\n' 'set -g mouse on' >> ~/.tmux.conf \
    && printf '%s\n' 'set -g base-index 1' >> ~/.tmux.conf \
    && printf '%s\n' 'set -g pane-base-index 1' >> ~/.tmux.conf
