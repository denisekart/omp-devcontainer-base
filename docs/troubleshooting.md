# Troubleshooting

Consumer-facing fixes: symptom → cause → fix. All commands run inside the container terminal.

## Models Won't Connect

**Symptom:** `omp` starts but errors when the agent tries to reach a model.

**Cause:** the endpoint is unreachable from the container, the `apiKey` is wrong, or the session started before `models.yml` was edited.

**Fix:**

- Test reachability from inside the container: `curl -sSf <baseUrl>` (your `models.yml` `baseUrl`)
- For host-local LLM servers use `http://host.docker.internal:<port>/v1` — `localhost` inside the container is the container itself
- Verify the `apiKey` for your endpoint
- After editing `models.yml`, start a **new** `omp` session — a running session does not reload the file

## Hindsight Not Responding

**Symptom:** `curl http://localhost:8888/health` fails; memory tools error.

**Cause:** the Hindsight server is down and the supervisor has not restarted it yet, or the `hindsight` tmux session (the supervisor) is missing.

**Fix:**

- `curl http://localhost:8888/health`
- `tmux ls` — is the `hindsight` session there?
- Check the log: `~/.hindsight/hindsight.log`
- The supervisor self-heals on a 15-second poll; to restart it manually:

  ```bash
  tmux kill-session -t hindsight
  tmux new-session -d -s hindsight 'bash /usr/local/share/omp-scripts/hindsight-supervisor.sh'
  ```

## Restore Defaults

**Symptom:** seeded `~/.omp/agent/` config has drifted and you want the image defaults back.

**Cause:** seeding never overwrites existing files, so edited files stick around.

**Fix:**

- Single file: delete the specific file under `~/.omp/agent/`, then re-run `bash /usr/local/share/omp-scripts/seed-omp-home.sh`
- Full reset (**DANGEROUS** — wipes all user edits): `rm -rf ~/.omp/agent ~/.omp/.seeded-v1`, then re-run the seed script

## Reinstall Plugins

**Symptom:** plugins are missing or broken.

**Fix:**

```bash
rm ~/.omp/.plugins-installed-v1 && bash /usr/local/share/omp-scripts/install-omp-plugins.sh
```

See [plugins.md](plugins.md) for the adopted/deferred decisions.

## Re-run Bootstrap / Change Stack Preset

**Symptom:** the workspace was bootstrapped with the wrong stack, or you want a file regenerated.

**Fix:**

```bash
bash /usr/local/share/omp-scripts/bootstrap.sh --stack <preset>
```

Presets: `dotnet-aspire-svelte`, `dotnet-only`, `svelte-only`, `generic`. `write_if_absent` never overwrites — delete the specific `AGENTS.md` / `.omp/*` file first if you want the regenerated version.

## Git Identity Missing

**Symptom:** git commands warn about missing identity.

**Cause:** `~/.gitconfig` is a symlink to `~/.persisted-git/gitconfig` (the persistent volume); the link may be missing.

**Fix:**

- If the link is missing: `bash /usr/local/share/omp-scripts/link-gitconfig.sh`
- Then set your identity: `git config user.name "..."` and `git config user.email "..."` (written to the persistent gitconfig)

## Docker-in-Docker Not Working

**Symptom:** `docker` commands fail inside the container.

**Cause:** the docker-in-docker feature did not initialize.

**Fix:**

- Check with `docker version` — both client and server sections should print
- The `vscode` user is a member of the `docker` group with non-root docker enabled; if it still fails, check the VS Code container setup output for the docker-in-docker feature

## TUI Corruption / Stray Output in the omp Screen

**Symptom:** garbage characters or background-job output leaking into the `omp` TUI.

**Cause:** a background job was started with a bare `&` in a terminal shared with TUI apps.

**Fix:** background jobs must go through `bgrun` (see [tmux.md](tmux.md), section 5); never use bare `&` in a terminal shared with TUI apps.

## Image Update Didn't Pick Up New Defaults

**Symptom:** after updating to a newer image, new image defaults are missing.

**Cause:** seeding never overwrites existing files.

**Fix:**

- NEW default files auto-merge on reseed automatically.
- For a specific stale file: delete it under `~/.omp/agent/`, then re-run `bash /usr/local/share/omp-scripts/seed-omp-home.sh` (see [Restore Defaults](#restore-defaults)).
- For bulk edited/deleted files: run `bash /usr/local/share/omp-scripts/sync-omp-defaults.sh` — it force-syncs only the defaults surface (`agents/`, `skills/`, top-level config files) without touching live state (`sessions/`, `*.db*`, `cache/`). See [Change Flow](architecture.md#change-flow) for details.

## Port Forwarding

**Symptom:** newly-created ports (Aspire randomized ports, `omp /stats` on 3847, dev servers) do not appear auto-forwarded.

**Cause:** the consumer repo's own `.devcontainer/devcontainer.json` still sets the `0-65535` entry's `onAutoForward` to `"ignore"` (a copy of an older template), or the container has not been reopened since the config changed.

**Fix:** in the repo's `.devcontainer/devcontainer.json`, set the `0-65535` entry's `onAutoForward` to `"notify"`, then reopen the container (devcontainer CLI: `devcontainer reopen`; VS Code: "Rebuild Container"). Forwarded ports then appear in the Forwarded Ports panel with `localhost:<port>` links.
