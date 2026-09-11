---
name: zmk-zephyr
description: ZMK split-keyboard firmware — keymaps (devicetree overlays), boards, shields, modules, west/zmk CLI builds, and flashing.
---
# ZMK (Zephyr)

## When to use

- Writing or modifying ZMK `.keymap` / `.conf` / `.overlay` files (devicetree).
- Adding a new ZMK behavior module or Zephyr module.
- Building/flashing ZMK firmware with `west` or `zmk` CLI.
- Working in a ZMK config repo (`zmk-config` layout: `keymap/`, `conf/`, `modules/`, `build.yaml`).

## Rules

1. **Keymaps are devicetree**: a `.keymap` file is a DT overlay applied to the board. Use `&keymap { ... }` with `<keycode>` entries. Layer names, `combos`, `mod-tap`, and `hold-tap` are ZMK behaviors (Zephyr Kconfig + DT).
2. **Board ID format**: `west build -b <board>//zmk` (e.g. `nice_nano//zmk`). Add-on MCUs use `-- -DSHIELD=<shield>` (e.g. `-b proton_c//zmk -- -DSHIELD=kyria_left`).
3. **Split keyboards**: build each half into a separate build dir:
   - `west build -d build/left  -b nice_nano//zmk -- -DSHIELD=kyria_left`
   - `west build -d build/right -b nice_nano//zmk -- -DSHIELD=kyria_right`
   Use `--pristine`/`-p` when switching board/shield.
4. **Build from `app/`**: `west build` must run from the `app/` subdirectory of a ZMK checkout, or CMake fails ("source directory does not contain a CMakeLists.txt").
5. **ZMK config repo**: user keymaps/conf live in a separate `zmk-config` repo. Pass `-DZMK_CONFIG=/path/to/zmk-config` to `west build`. The `zmk` CLI (`zmk init`, `zmk keyboard add`, `zmk code`) manages this repo.
6. **Modules**: `zmk module add <url>` installs a Zephyr module into the config repo. `zmk update` refreshes local ZMK + modules. Modules are Zephyr modules (have their own `CMakeLists.txt` + `Kconfig`).
7. **Flashing**: `west flash` (uses the board's flash runner). For DFU: convert with `uf2conv` (ships in the Zephyr SDK host tools, not a standalone package) then `dfu-util -d 1915:521f -a -D zmk.uf2`. For non-Nordic debug probes: `pyocd` / `openocd`.
8. **Zephyr SDK env**: `ZEPHYR_TOOLCHAIN_VARIANT=llvm` and `ZEPHYR_CLANG_SYSROOT` must be set (baked into the image at `/etc/profile.d/zephyr.sh` and `~/.zshrc`). `west build` auto-detects the SDK from `PATH`.

## Gotchas

- A missing `ZEPHYR_TOOLCHAIN_VARIANT` makes `west build` fall back to the system gcc — usually wrong for ZMK. Verify `which clang` resolves to `/opt/zephyr/zephyr-llvm*/bin/clang`.
- `west zephyr-export` + `west packages pip --install` are one-time setup steps (ZMK native-setup doc). Not needed in this image (west is installed; packages are installed per-workspace).
- ZMK CLI stores a local ZMK copy in `.zmk/` (gitignored). `zmk keyboard list` reads from it; `zmk update` refreshes it.
- `build.yaml` in a ZMK config repo lists keyboards to build. `zmk keyboard add` edits it.
- The ZMK docs at `docs.zmk.dev` are the source of truth for board/shield names; verify against the docs, not model memory.

## Workflow (build + flash a keyboard)

```bash
# 1. Ensure env
source /etc/profile.d/zephyr.sh   # or rely on zshrc exports
# 2. From the ZMK checkout's app/ dir
cd app
# 3. Build (onboard MCU example)
west build -b planck//zmk -- -DZMK_CONFIG=/path/to/zmk-config
# 4. Flash
west flash
```

## Checklist

- [ ] Building from `app/` subdirectory?
- [ ] Board ID uses `//zmk` variant form?
- [ ] Add-on MCU uses `-- -DSHIELD=<shield>`?
- [ ] Split keyboard uses separate `build/left` / `build/right` dirs?
- [ ] `ZEPHYR_TOOLCHAIN_VARIANT=llvm` is set (clang on PATH)?
- [ ] `west flash` or correct flash tool used for the target?
- [ ] Keymap changes are DT overlays under `&keymap { }`?
