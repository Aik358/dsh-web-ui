# Agent Note: relative cohort tarball overrides and local harness detection

Status: implemented

## Problem

此前的[预览版 SDK 覆盖](2026-08-28-preview-cohort-tarball-overrides.md)与 [CI 离线包存储构建](2026-08-29-ci-rebuilds-cohort-tarball-store.md)在 `pnpm-workspace.yaml` 中硬编码了原作者的绝对路径 `file:/Users/zcl/.dsh-cohorts/0.1.2-alpha.1/`。在第二位开发者机器或用户名不同的环境（例如 Windows 下的 `C:\Users\A\`）中，pnpm 在依赖检查阶段尝试访问硬编码的 `/Users/zcl/` 目录并报 `ENOENT` 失败。此外，使用本地已有的 `deepseek-harness` 仓库构建离线包时每次都需要显式传入命令行参数。

## Decision

将 `pnpm-workspace.yaml` 中的 `overrides:` 块以及 `pnpm-lock.yaml` 中的导入声明全部重写为相对路径声明（`file:../../.dsh-cohorts/0.1.2-alpha.1/...`）。由于代码检出目录位于工作区根部，向上两级路径在不同用户名和操作系统下均稳定指向用户主目录下的 `.dsh-cohorts/`，不再将特定开发者的绝对路径提交进版本库。

更新 `scripts/build-cohort-tarballs.mjs`，支持自动探测同级目录下的本地 `deepseek-harness` 仓库（`../deepseek-harness` 或 `../../deepseek-harness`）及 `DSH_HARNESS_DIR` 环境变量，在已有本地源码时避免重复远程克隆；新增 `--skip-commit-check` 参数以便针对自定义本地分支进行打包调试。

## Alternatives considered

- 保留绝对路径覆盖并要求开发者在本地各自修改 `pnpm-workspace.yaml`：已否决；这会导致工作区产生本地脏改动、意外提交个人路径并破坏 lockfile 严格校验。
- 直接移除 overrides 改为 npm 依赖：作为前置步骤暂不直接采用；虽然上游已发布 `0.1.2-alpha.2`，但保留自包含的相对路径解析能力可保障离线开发与多开发者协作。

## Consequences

多位开发者可以顺利检出仓库、运行 `node scripts/build-cohort-tarballs.mjs` 并执行 `pnpm install --frozen-lockfile`，不会再遇到硬编码机器路径错误，也无需手动修改 workspace 配置。
