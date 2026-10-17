# dsh-pet 官方桌面端适配发行版（二次创作，非原创）

<p align="center">
  <a href="https://github.com/zhuge886/DSH-pet-Deepseek-Official-Desktop"><img alt="derivative work based on dsh-pet" src="https://img.shields.io/badge/%E4%BA%8C%E5%88%9B-%E5%9F%BA%E4%BA%8E%20dsh-pet-blue"></a>
  <a href="https://github.com/zhuge886/DSH-pet-Deepseek-Official-Desktop/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/github/license/zhuge886/DSH-pet-Deepseek-Official-Desktop?color=orange"></a>
  <a href="https://github.com/zhuge886/DSH-pet-Deepseek-Official-Desktop"><img alt="repo size" src="https://img.shields.io/github/repo-size/zhuge886/DSH-pet-Deepseek-Official-Desktop"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-DeepSeek%20Harness%20Desktop-8A2BE2">
</p>

> **本仓库不是原创作品。** 它是桌宠 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（作者 **PC2005-cloud**，MIT）的**二次创作**，只做一件事：让上游桌宠在 **DeepSeek Harness 官方桌面端（Electron 版）** 装上、能启用、可管理。桌宠本体、动画素材、全部玩法与文档都来自上游，版权归原作者。

---

## 📌 非原创声明

| 内容 | 归属 |
| --- | --- |
| 桌宠本体、106 段动画与素材、提示词、玩法（待机 / 漫游 / 拖拽抛掷 / 余额 / 碎碎念 / 对话 / 工作状态 / 系统通知 / pet pack） | 上游 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT） |
| 官方桌面端适配层（`adapter/`）、组合包声明、上游产物同步与校验、安装 / 兼容 / 排障文档、测试 | 本仓库（基于上游的二次创作） |

`vendor/` 内是上游 npm 发布版 `dsh-pet@0.3.7` 的已构建产物，`dsh-pet/assets/` 内是上游的动画与素材——本仓库没有、也不试图拥有上游的任何内容。按上游「二创约定」：任何介绍、展示、分发本仓库的地方，请保留上游作者地址 <https://github.com/PC2005-cloud/dsh-pet>。

## 🚀 安装（官方桌面端）

1. 桌面应用 → **插件管理 → 添加插件**；
2. 填本仓库地址：

   ```text
   https://github.com/zhuge886/DSH-pet-Deepseek-Official-Desktop
   ```

   （等价 pnpm spec：`github:zhuge886/DSH-pet-Deepseek-Official-Desktop`）
3. 启用 `dsh-pet` 组合包，**重开桌面应用**。

默认只显示**一只**：窗口外那只透明置顶小窗（`display: desktop`）。想改成应用内 / 两只 / 不显示，见 [DESKTOP.md §12](DESKTOP.md) 或设置页「桌宠配置」。

## ✅ 验证

桌宠加载后，DSH 自己的 Web 服务上会多一个只读接口：

```text
GET http://127.0.0.1:<port>/dsh-pet-desktop/health
```

返回 `status: active`、`host.kind: desktop`、`upstream.applied: true` 即适配层与上游都已就绪（字段含义见 [DESKTOP.md §3](DESKTOP.md)）。

## 📦 本仓库只保留「适配官方桌面端」所需

```text
adapter/                 适配层：宿主识别、运行时诊断、健康检查、失败降级
cordis.patch.yml         组合包声明（桌面端插件管理据此把它当插件）
vendor/dsh-pet-0.3.7/    上游已构建产物（免构建，SHA-256 逐文件校验）
dsh-pet/assets/          运行时素材（webm / 字体 / 表情包 / 默认配置）
tests/                   清单、适配层纯逻辑、启动冒烟
DESKTOP.md               为什么需要、兼容矩阵、排障、版本记录
scripts/sync-vendor.mjs  上游产物同步与可审计补丁
```

**不在本仓库**（都在上游）：`src/` 源码、素材生成链（提示词 + Python 脚本）、HTTP API 文档、生态清单、玩法与配置手册。

## 🔗 功能、玩法、二次创作 → 去上游

- 功能与配置、动画与 pet pack、HTTP API、问题反馈：<https://github.com/PC2005-cloud/dsh-pet>
- 本仓库改了什么、兼容性与排障：[DESKTOP.md](DESKTOP.md)

## 许可

- 代码：MIT（上游版权归 **PC2005-cloud**；本仓库的适配改动同样以 MIT 提供）
- 素材（动画 / 提示词 / 源视频）：允许开源使用，**禁止商用**
- 二次创作：请保留上游作者地址 <https://github.com/PC2005-cloud/dsh-pet>

## 版本

当前 `0.3.7-desktop.3`（基于上游 `dsh-pet@0.3.7`）。变更见 [DESKTOP.md §11](DESKTOP.md)。
