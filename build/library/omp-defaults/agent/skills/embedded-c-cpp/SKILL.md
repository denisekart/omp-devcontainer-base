---
name: embedded-c-cpp
description: Embedded C/C++ idioms, memory model, and Zephyr RTOS patterns (Kconfig, devicetree, interrupts, ISR safety).
---
# Embedded C/C++ (Zephyr)

## When to use

- Writing or modifying `.c`/`.cpp`/`.h` firmware, Zephyr drivers, or ZMK behaviors.
- Adding new Kconfig options or devicetree bindings.

## Rules

1. **Static allocation**: no `malloc`/`new` in interrupt context or after boot unless a heap is explicitly enabled. Prefer static buffers, `STRUCT_SECTION`, and Kconfig-driven sizing.
2. **ISR safety**: `IRQ_CONNECT` handlers must be short. Use `k_sem`, `k_msgq`, or `k_work` to defer real work to a thread. Never call `LOG_*` with a format string in an ISR unless `CONFIG_LOG` is compiled.
3. **Kconfig over `#define`**: all tunables are `Kconfig` symbols (`CONFIG_<NAME>`). Add `Kconfig` + default in the driver's `Kconfig` file; reference as `IS_ENABLED(CONFIG_FOO)`.
4. **Devicetree**: hardware description lives in `.dts`/`.overlay`. Use `DT_NODELABEL()`, `DT_INST_*` macros. Do not hardcode register addresses in C; bind via `struct device` + `DEVICE_DT_*`.
5. **Zephyr APIs only**: `k_thread_create`, `k_timer`, `k_fifo`, `zmk_*` — no bare `pthread`, no `printf` (use `LOG_*`), no `std::cout`.
6. **C11/C++17**: C code is C11 (`-std=c11`); C++ is C++17. No C99-in-headers issues; guard C++ with `extern "C"` when mixing.
7. **Memory barriers**: use `sys_cache_*` and `arch_mem_fence_*` when touching DMA buffers. Never assume compiler reorder across MMIO.
8. **No dynamic linking**: `CONFIG_SHARED_LIB` is off; all code is linked statically into the firmware image.

## Gotchas

- `LOG_LEVEL` is set per-module in `Kconfig`; a `LOG_ERR` that "doesn't print" usually means the module's log level is `off`.
- `DEVICE_DT_*` returns `NULL` if the DT node is disabled — check `device_is_ready()`.
- `ZMK_CONFIG` (CMake) points at a user config repo; a missing `-DZMK_CONFIG=` means the build uses `app/` defaults.
- Board IDs since Zephyr 4.1 use the `//zmk` variant suffix (e.g. `planck//zmk`), not the old `planck_rev6` form.

## Checklist

- [ ] No heap allocation in ISR / boot path?
- [ ] New tunables are `Kconfig` symbols, not `#define`?
- [ ] Hardware access via `struct device` + DT macros, not hardcoded addresses?
- [ ] `device_is_ready()` checked before use?
- [ ] `LOG_*` used instead of `printf`/`std::cout`?
- [ ] Board ID uses `//zmk` variant form?
