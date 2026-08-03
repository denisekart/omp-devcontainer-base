FROM mcr.microsoft.com/devcontainers/base:bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH=$PATH:$DOTNET_ROOT:/home/vscode/.dotnet/tools:/home/vscode/.local/bin:/root/.bun/bin

# Install core packages and tooling
RUN apt-get update && apt-get -y install --no-install-recommends     wget     curl     apt-transport-https     ca-certificates     gnupg     lsb-release     git     jq     ripgrep     fd-find     fzf     python3     python3-pip     python3-venv     build-essential     libssl-dev     pkg-config     zoxide     bat     unzip     procps     libxext6     libxrender1     libxtst6     libxi6     libfreetype6     xdg-utils     tmux     shellcheck     && rm -rf /var/lib/apt/lists/*

# Install yq (YAML processor)
RUN set -eux;     arch="$(dpkg --print-architecture)";     case "$arch" in       amd64|arm64) yq_arch="$arch" ;;       *) yq_arch="amd64" ;;     esac;     wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${yq_arch}";     chmod +x /usr/local/bin/yq

# Install eza (modern ls replacement)
RUN set -eux;     mkdir -p /etc/apt/keyrings;     if apt-get update && apt-get install -y --no-install-recommends eza; then       :;     else       rm -rf /var/lib/apt/lists/*;       arch="$(dpkg --print-architecture)";       case "$arch" in         amd64) eza_arch="x86_64" ;;         arm64) eza_arch="aarch64" ;;         *) eza_arch="x86_64" ;;       esac;       tmpdir="$(mktemp -d)";       wget -qO "$tmpdir/eza.tar.gz" "https://github.com/eza-community/eza/releases/latest/download/eza_${eza_arch}-unknown-linux-gnu.tar.gz";       tar -xzf "$tmpdir/eza.tar.gz" -C /usr/local/bin eza;       rm -rf "$tmpdir";     fi;     rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh

# Install .NET 10 SDK using official install script
RUN curl -sSL https://dotnet.microsoft.com/download/dotnet/scripts/v1/dotnet-install.sh | bash /dev/stdin --channel 10.0 --install-dir "$DOTNET_ROOT"     && ln -s "$DOTNET_ROOT/dotnet" /usr/local/bin/dotnet

# Install Aspire workload
RUN dotnet workload install aspire

# Install git-delta
RUN set -eux;     if apt-get update && apt-get install -y --no-install-recommends git-delta; then       :;     else       rm -rf /var/lib/apt/lists/*;       arch="$(dpkg --print-architecture)";       case "$arch" in         amd64) delta_arch="amd64" ;;         arm64) delta_arch="arm64" ;;         *) delta_arch="amd64" ;;       esac;       tmpdir="$(mktemp -d)";       wget -qO "$tmpdir/git-delta.deb" "https://github.com/dandavison/delta/releases/latest/download/git-delta_$(dpkg --print-architecture)_unknown_$(dpkg --print-architecture).deb" ||       wget -qO "$tmpdir/git-delta.deb" "https://github.com/dandavison/delta/releases/latest/download/git-delta_0.19.2_${delta_arch}.deb";       dpkg -i "$tmpdir/git-delta.deb" || apt-get -f install -y;       rm -rf "$tmpdir";     fi;     rm -rf /var/lib/apt/lists/*

# Install Starship prompt
RUN curl -sS https://starship.rs/install.sh | sh -s -- -y -b /usr/local/bin

# Install Node.js 24 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -     && apt-get update     && apt-get install -y --no-install-recommends nodejs     && rm -rf /var/lib/apt/lists/*

# Update npm and install global npm tools
RUN npm install -g npm@latest     && npm install -g typescript pnpm typescript-language-server svelte-language-server vscode-langservers-extracted bash-language-server

# Install bun runtime
RUN curl -fsSL https://bun.sh/install | bash -s -- --install-dir /usr/local/bin

# Install oh-my-pi globally using bun
RUN bun install -g @oh-my-pi/pi-coding-agent

# Install Puppeteer apt dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     libnss3     libatk-bridge2.0-0     libxcomposite1     libxrandr2     libxdamage1     libgbm1     libasound2     libpangocairo-1.0-0     libxshmfence1     && rm -rf /var/lib/apt/lists/*

# Install shell formatter
RUN arch="$(dpkg --print-architecture)" &&     wget -qO /usr/local/bin/shfmt "https://github.com/mvdan/sh/releases/download/v3.13.1/shfmt_v3.13.1_linux_${arch}" &&     chmod +x /usr/local/bin/shfmt

# Ensure vscode user belongs to docker group (required for DinD)
RUN groupadd -f docker     && usermod -aG docker vscode

# Final environment setup
RUN apt-get update && apt-get install -y --no-install-recommends zsh iptables figlet     && chsh -s /usr/bin/zsh vscode     && rm -rf /var/lib/apt/lists/*

# Fix iptables permissions for Docker-in-Docker
RUN if [ -f /usr/sbin/iptables-legacy ]; then         update-alternatives --install /usr/sbin/iptables iptables /usr/sbin/iptables-legacy 10         && update-alternatives --set iptables /usr/sbin/iptables-legacy;     fi &&     if [ -f /usr/sbin/ip6tables-legacy ]; then         update-alternatives --install /usr/sbin/ip6tables ip6tables /usr/sbin/ip6tables-legacy 10         && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy;     fi

USER vscode

# Baked omp defaults directory placeholder
RUN mkdir -p /usr/local/share/omp-defaults/agent/skills/core     && mkdir -p /usr/local/share/omp-defaults/agent/profiles/dotnet-aspire/skills     && mkdir -p /usr/local/share/omp-defaults/agent/profiles/svelte/skills     && mkdir -p /usr/local/share/omp-defaults/agent/personas     && chown -R vscode:vscode /usr/local/share/omp-defaults

# User-level tools
RUN dotnet tool install -g dotnet-ef
RUN dotnet tool install -g Aspire.Cli --prerelease
RUN dotnet tool install -g csharp-ls
RUN uv tool install python-lsp-server
RUN uv tool install mcp-server-docker
RUN uv tool install mcp-server-fetch
RUN uv tool install mcp-server-git
RUN uv tool install mcp-server-time
RUN uv pip install hindsight-all

# Shell configuration
RUN mkdir -p ~/.zsh_history_dir     && printf '%s
' 'export HISTFILE=~/.zsh_history_dir/.zsh_history' >> ~/.zshrc     && printf '%s
' 'export HISTSIZE=10000' >> ~/.zshrc     && printf '%s
' 'export SAVEHIST=10000' >> ~/.zshrc     && printf '%s
' 'eval "$(starship init zsh)"' >> ~/.zshrc     && printf '%s
' 'eval "$(zoxide init zsh)"' >> ~/.zshrc     && printf '%s
' 'alias cat="batcat"' >> ~/.zshrc     && printf '%s
' 'alias oc="omp"' >> ~/.zshrc     && printf '%s
' 'alias fd="fdfind"' >> ~/.zshrc     && printf '%s
' 'export PATH=$PATH:/home/vscode/.dotnet/tools:/home/vscode/.local/bin' >> ~/.zshrc     && printf '%s
' '' >> ~/.zshrc     && printf '%s
' '# ── Prevent background job output from corrupting TUI displays ──────────' >> ~/.zshrc     && printf '%s
' '# (omp, vim, htop, etc. all use alternate screen buffers; output' >> ~/.zshrc     && printf '%s
' '#  from unsuppressed background jobs leaks through and pollutes the TUI)' >> ~/.zshrc     && printf '%s
' 'setopt NO_MONITOR    # suppress "[n] done" job notifications' >> ~/.zshrc     && printf '%s
' 'setopt BG_NICE       # nice background jobs (lower priority)' >> ~/.zshrc     && printf '%s
' 'setopt NO_CHECK_JOBS # do not report stopped/exited jobs at prompt' >> ~/.zshrc     && printf '%s
' '' >> ~/.zshrc     && printf '%s
' '# Run a command in the background with stdout+stderr fully suppressed.' >> ~/.zshrc     && printf '%s
' '# This is the ONLY safe way to background a long-running command.' >> ~/.zshrc     && printf '%s
' '# Usage:  bgrun dotnet run --project src/App.AppHost' >> ~/.zshrc     && printf '%s
' '#         bgrun tail -f /var/log/syslog' >> ~/.zshrc     && printf '%s
' 'bgrun() {' >> ~/.zshrc     && printf '%s
' '  local logfile="/tmp/bgrun-$$.log"' >> ~/.zshrc     && printf '%s
' '  "$@" > "$logfile" 2>&1 &' >> ~/.zshrc     && printf '%s
' '  disown' >> ~/.zshrc     && printf '%s
' '  echo "Background: PID=$! log=$logfile"' >> ~/.zshrc     && printf '%s
' '}' >> ~/.zshrc

# Configure tmux for agent use
RUN printf '%s
' 'set -g default-terminal "screen-256color"' >> ~/.tmux.conf     && printf '%s
' 'set -g mouse on' >> ~/.tmux.conf     && printf '%s
' 'set -g base-index 1' >> ~/.tmux.conf     && printf '%s
' 'set -g pane-base-index 1' >> ~/.tmux.conf
