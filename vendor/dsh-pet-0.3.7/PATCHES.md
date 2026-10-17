# 内置上游构建产物（只读）

本目录是 npm 上 `dsh-pet@0.3.7` 的**已构建产物**（`lib/` + `runtime/`），供「官方桌面端适配包」免构建直接安装。
由 `scripts/sync-vendor.mjs` 生成，请勿手改；升级上游时重跑该脚本。

## 与上游 tarball 的差异

1. `lib/index.js` 的 `PACKAGE_ROOT` 由「包根」改为「仓库内 `dsh-pet/`」——
   这样 `assets/`（含 54MB 的 `webm`）复用仓库里那份，不必在 `vendor/` 下重复一份；
   桌面运行时 `runtime/electron-helper/` 仍取本目录内与 `lib` 同版本的副本，避免宿主包
   与上游 main 分支的运行时产生协议漂移。
2. **Electron 下载依赖改为按需加载**：删除顶层 `import { downloadArtifact } from "@electron/get"`，
   改成首次真正需要下载时再 `import()`。官方桌面端的插件管理用 `link:` 装本地目录时不会安装
   被链接包的依赖；静态导入会让「缺 @electron/get」在激活阶段直接 ERR_MODULE_NOT_FOUND，
   连浏览器 overlay 一起挂掉。按需加载后只有桌面形态降级，并给出可操作提示。
3. 只保留运行所需文件：`lib/index.js`、`lib/client.js`、`runtime/`、`package.json`、`LICENSE`；
   类型声明与独立模式 CLI 不随适配包发布。

校验值见 `vendor-manifest.json`（逐文件 SHA-256）。
