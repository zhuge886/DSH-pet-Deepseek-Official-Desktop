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
3. **拖拽跟手调紧**：`lib/client.js` 与 `runtime/electron-helper/shared-core.js` 的拖拽跟随弹簧
   `SPRING_K/SPRING_C` 由 `200/30` 改为 `800/50`——稳态滞后从 `0.15 × 光标速度` 降到
   `0.0625 × 光标速度`（480px/s 拖动实测约 40px → 约 17px），阻尼比 0.88 无可见回弹。
   只影响拖拽跟随，抛掷/反弹/落地摩擦/挤压曲线不变。
4. **鼠标活动 → 待机链主动加动作**：鼠标在动（2.5s 内有过移动）时，待机随机链每 18~28 秒
   **强制**抽一段「动作」分类播放（像在陪着干活）；鼠标静下来就退回原有权重抽签。
   桌面 helper 的穿透小窗收不到窗外鼠标移动，故由主进程按全局光标判定（250ms 限流）经 IPC
   通知渲染端；浏览器 overlay 直接监听 `window pointermove`。只影响随机链，拖拽/点播/事件动画不变。
5. 只保留运行所需文件：`lib/index.js`、`lib/client.js`、`runtime/`、`package.json`、`LICENSE`；
   类型声明与独立模式 CLI 不随适配包发布。

校验值见 `vendor-manifest.json`（逐文件 SHA-256）。
