# 官方桌面端适配包（包名仍是 `dsh-pet`）

> **📌 非原创声明**：本仓库**不是原创作品**，是 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（作者 **PC2005-cloud**，MIT）的**二次创作**——只增加「让上游插件在 DeepSeek Harness 官方桌面端装上、可管理」的适配层、组合包声明、同步校验、文档与测试；桌宠本体、素材与全部玩法归上游作者。详见 [README.md](README.md) 的「📌 非原创声明」。

本仓库根目录现在是一个**可直接安装的 DSH 组合包（bundle）**，专门解决「dsh-pet 在 DeepSeek Harness 官方桌面端（Electron 版）装不上/装完不可管理」的问题（对应上游 issue #103）：

> 在官方桌面版安装该插件时，提示「这个包没有声明组合包，不能作为插件管理」。

适配包不重写桌宠逻辑：它把上游 **0.3.7 的已构建产物**（`vendor/dsh-pet-0.3.7/`）原样内置，只在外面加一层很薄的官方桌面端适配。

> 包名必须保持 `dsh-pet`：浏览器半边的 `window.__ModuleLoader__.load({ id: "dsh-pet" })` 与包名绑定，改名会让客户端模块加载不到。

---

## 1. 为什么需要适配包

| 现状 | 后果 |
| --- | --- |
| 仓库根没有 `package.json` | 桌面端「从 Git 仓库安装」只能拿到仓库根，pnpm 装出来的包没有 `dsh.bundle` → 报「没有声明组合包」 |
| 插件本体在 `dsh-pet/` 子目录 | 即使装到子目录，也不是 Git 安装的默认入口 |
| `dsh-pet/lib/` 被 `.gitignore` 忽略 | 从 GitHub 装下来没有构建产物，必须本地 `npm install && npm run build`，而桌面端插件管理不会替你构建 |
| 兼容清单只写到 `0.2.0-rc.2` | 当前官方桌面端 `0.2.1-rc.1` 不在声明里，商城/清单无法判断兼容 |
| 上游初始化失败会拖垮 profile | 上游 issue #80：一个 entry 激活失败会让整个 DSH 起不来 |
| 桌面端「本地目录」用 `link:` 安装，不装被链接包的依赖 | 上游顶层静态 import `@electron/get` → 激活阶段 `ERR_MODULE_NOT_FOUND`，连浏览器 overlay 一起挂掉（见第 9 节） |

适配包逐条处理：

1. **根目录 `package.json` + `cordis.patch.yml`**：声明 `dsh.bundle.patch`，entry id/name 都是 `dsh-pet`；
2. **`vendor/dsh-pet-0.3.7/`**：npm 已构建的 `lib/` + `runtime/` 随仓库分发，安装后**无需构建**；
3. **兼容清单**补上 `0.2.1-rc.1: compatible`，peer 范围放宽到 `^0.2.0-rc.1 || ^0.2.1-rc.1`；
4. **`adapter/host.js` 适配层**：识别官方桌面宿主、做运行时诊断、注册只读健康检查；上游初始化失败时**只记录不抛错**（可用 `resilient: false` 关掉），不再阻断 DSH 启动。
5. **下载依赖按需加载**：`@electron/get` / `@electron-internal/extract-zip` 只在真正要下载 Electron 时才 `import()`，缺依赖不再影响插件激活。
6. **拖拽跟手调紧**：上游拖拽跟随弹簧的稳态滞后是 `0.15 × 光标速度`（480px/s 实测约 40px，快速拖动可到 150px+，观感就是「窗口拖住了宠物」「拖出应用窗口要等一下才跟过来」）。补丁把 `SPRING_K/SPRING_C` 从 `200/30` 调到 `800/50`，滞后降到 `0.0625 × 光标速度`、阻尼比 0.88（无可见回弹）；只动拖拽跟随这一条弹簧，抛掷速度/重力/反弹/落地摩擦/挤压曲线都不变。

---

## 2. 安装

### 官方桌面应用（推荐）

1. 打开 **插件管理 → 添加插件**；
2. 安装源选 **Git 仓库**（或直接把下面整段填进输入框）：

   ```text
   https://github.com/zhuge886/DSH-pet-Deepseek-Official-Desktop
   ```

   等价的 pnpm spec：`github:zhuge886/DSH-pet-Deepseek-Official-Desktop`。
3. 安装完成后在插件列表里**启用** `dsh-pet` 组合包；
4. 重开桌面应用（宿主半边的改动需要重启，浏览器半边刷新即可）。

> 仓库带 100MB+ 素材，首次从 GitHub 安装会比 npm 慢；装完后桌宠出现在界面右上角（默认 `display: both`，桌面形态会另开透明置顶小窗）。

### `dsh web` / 终端

```sh
dsh plugin --profile web add github:zhuge886/DSH-pet-Deepseek-Official-Desktop
# 官方桌面应用使用 desktop profile 时：
dsh plugin --profile desktop add github:zhuge886/DSH-pet-Deepseek-Official-Desktop
```

### 本地目录（开发）

```sh
dsh plugin --profile web add file:D:/path/to/dsh-pet
```

桌面应用内安装本地目录时，填上面的绝对路径即可。

### 与 npm 包的关系

- 想装上游原版、不需要仓库根适配：仍然可以在插件管理里填 `dsh-pet`（npm 包，发布版 0.3.7）。
- 本适配包的包名也是 `dsh-pet`（浏览器模块 id 必须与包名一致），**不要和 npm 版同时装**；切换前先卸载另一个。

---

## 3. 验证

桌宠加载后，DSH 自己的 Web 服务上会多一个只读接口：

```text
GET http://127.0.0.1:<port>/dsh-pet-desktop/health
```

在桌面应用里直接用内置浏览器打开（会带上登录态），返回示例：

```json
{
  "ok": true,
  "adapter": { "id": "dsh-pet-desktop", "upstream": "0.3.7" },
  "status": "active",
  "host": {
    "kind": "desktop",
    "electronVersion": "44.7.0",
    "officialDesktopShell": true,
    "clientVersion": "0.2.1-rc.1",
    "dshHome": "C:\\Users\\<you>\\.dsh",
    "platform": "win32"
  },
  "runtime": {
    "electronPath": null,
    "source": null,
    "requiresDownload": true,
    "downloadRoot": "C:\\Users\\<you>\\.dsh\\electron",
    "downloadDependencies": {
      "ready": false,
      "missing": ["@electron/get", "@electron-internal/extract-zip"],
      "dependencies": ["@electron/get", "@electron-internal/extract-zip"]
    },
    "hazards": [{ "name": "ELECTRON_RUN_AS_NODE", "reason": "…" }]
  },
  "upstream": { "applied": true, "error": null },
  "health": { "route": "/dsh-pet-desktop/health", "registered": true, "error": null }
}
```

字段含义：

- `host.kind`：`desktop` = 宿主是 Electron（官方桌面端）；`web` = 纯 Node 的 `dsh web`；
- `host.officialDesktopShell` / `host.clientVersion`：检测到桌面壳注入的 `DSH_CLIENT_VERSION`（官方桌面端传的是应用版本）；
- `runtime.requiresDownload`：桌面形态所需的 Electron 是否已就绪；`true` 时首次启用桌面形态会下载到 `downloadRoot`；
- `runtime.downloadDependencies`：桌面形态首次下载 Electron 所需依赖是否可解析；`ready: false` 时桌面窗口会降级，浏览器 overlay 不受影响；
- `runtime.hazards`：会劫持 Electron 启动的继承环境变量（只报名字与原因，不回显敏感值）；
- `upstream.applied` / `upstream.error`：上游桌宠初始化是否成功。适配层默认 `resilient: true`，失败时 DSH 仍能启动。

日志里也能看到：

```text
[dsh-pet-desktop] 适配层已加载：host=desktop，electron=44.7.0，官方桌面壳=true，client=0.2.1-rc.1
[dsh-pet-desktop] 桌面运行时未就绪：首次启用桌面形态将下载 Electron 到 …；可用 DSH_PET_ELECTRON_PATH 复用已有运行时
```

---

## 4. 兼容性

| DSH 版本 | 状态 | 说明 |
| --- | --- | --- |
| `0.2.1-rc.1`（当前官方桌面端） | 适配 | 根 `package.json` 已声明；`tests/boot.test.mjs` 在该版本的 peer 上跑通插件初始化 |
| `0.2.0-rc.2` | 兼容 | 上游 0.3.7 的开发基线 |
| `0.2.0-rc.1` | 兼容 | 同上 |
| `0.1.7-rc.2` | 不兼容 | 上游已声明 |

平台：Windows / Linux / macOS 与上游一致。官方桌面端的插件宿主是 **Node 模式**（`ELECTRON_RUN_AS_NODE=1`），没有建窗 API——所以「桌面形态」仍然是插件自己拉起一个透明置顶 Electron，不是把桌宠塞进桌面应用主窗口。

---

## 5. 桌面形态与 Electron

- 默认 `display: both`：**即使 Electron 没装好，浏览器 overlay 也会出现在桌面应用窗口里**；桌面小窗只是额外形态。
- 首次启用 `desktop`/`both` 时，如果本机没有 Electron，上游会下载 Electron `43.3.0`（约 100MB，默认走 npmmirror）。可用以下环境变量复用已有运行时 / 换镜像：

  ```text
  DSH_PET_ELECTRON_PATH   # 已有 electron 可执行文件（electron.exe / Electron.app/Contents/MacOS/Electron）
  DSH_PET_ELECTRON_VERSION
  DSH_PET_ELECTRON_MIRROR # 默认 https://npmmirror.com/mirrors/electron/
  DSH_PET_DESKTOP_FORCE=1 # Linux 无 DISPLAY 时强制尝试
  ```

- `ELECTRON_RUN_AS_NODE` 由官方桌面壳注入（设计如此）。上游 spawn 前会删键；健康检查里 `runtime.hazards` 会把它列出来，方便对照崩溃日志（上游 issue #63 / #98）。
- 桌面 helper 与浏览器 overlay 共用同一份配置、素材与纯逻辑；多开、大小/位置、右键菜单行为一致。

---

## 6. 版本策略与升级

`vendor/dsh-pet-0.3.7/` 是**只读的上游已构建产物**，由脚本生成：

```sh
npm run sync:upstream                 # 版本取 package.json dsh.desktopAdapter.upstreamVersion
npm run sync:upstream -- --version 0.3.8
```

脚本会：校验 npm tarball 的 sha512 → 只解出 `lib/index.js`、`lib/client.js`、`runtime/`、`package.json`、`LICENSE` → 打一处可审计补丁（素材根指向仓库 `dsh-pet/assets`，避免 54MB webm 重复入库）→ 写 `vendor-manifest.json`（逐文件 SHA-256）。任何锚点数量不符都会失败，不会留下半成品。

> **`vendor/` 必须随 Git 提交**（它不在 `.gitignore` 里）。GitHub 安装只会拿到仓库里已提交的文件；只把生成的 `vendor/` 留在本地，别人从 Git 装下来仍然没有构建产物。
>
> 本包面向「从 Git 安装」，**不要 `npm publish`**——`dsh-pet` 这个包名属于上游 npm 包，发布会被拒绝或覆盖语义。

**注意**：本仓库**不含上游源码**（`src/`、素材生成链、提示词都在上游仓库），`vendor/` 固定为 npm 发布版 0.3.7。要带上游 `main` 分支的新特性，需在上游仓库 `npm run build` 后替换 `vendor/` 内容（或等上游发版后重跑 `sync:upstream`）。

---

## 7. 开发与测试

```sh
npm test          # manifest / 适配层纯逻辑 / 0.2.1-rc.1 boot 冒烟（无 peer 时自动 skip）
```

- `tests/manifest.test.mjs`：包清单、bundle patch、icon、exports、vendor 校验值、浏览器模块 id；
- `tests/desktop.test.mjs`：宿主识别、Electron 候选、环境风险、健康检查；
- `tests/boot.test.mjs`：用 DSH 0.2.1-rc.1 的 peer 真正初始化一次上游插件（`display: web`，不触发下载）。

---

## 8. 卸载与回滚

1. 插件管理里停用/卸载 `dsh-pet` 组合包；
2. 重开桌面应用；
3. 用户数据（配置、素材、对话记忆）在 `$DSH_HOME/dsh-pet/`，卸载插件不会删；需要彻底清理时手动删除该目录。

若只想临时绕过桌宠：把对应宠物的 `display` 改成 `web`（或 `none`），不必卸载插件。

---

## 9. 排障：`Cannot find package '@electron/get'`

在官方桌面端用**本地目录**安装时，插件管理会用 `link:` 把 profile 指向本仓库，而不是复制安装；`link:` 依赖**不会安装被链接包自己的依赖**。上游 0.3.7 在宿主入口顶层静态 import 了 `@electron/get`，于是激活阶段直接：

```text
启用失败: 1 entry did not activate dsh-pet (dsh-pet): failed to import:
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@electron/get' imported from
…\<本仓库目录>\vendor\dsh-pet-0.3.7\lib\index.js
```

适配包已把 `@electron/get` / `@electron-internal/extract-zip` 改成**按需加载**：激活不再失败，浏览器 overlay 正常出现；只有“桌面透明小窗”在缺依赖时降级。健康检查会给出 `runtime.downloadDependencies.missing`。

**想让桌面小窗也工作**，任选其一：

1. 在插件目录安装两个运行依赖（推荐，之后首次启用会下载 Electron）：

   ```sh
   cd <本仓库目录>
   npm install --omit=peer
   ```

   仓库根的 [.npmrc](.npmrc) 已设 `omit=peer`，直接 `npm install` 也不会去装 DSH 的 peer 依赖。

2. 复用已有 Electron：

   ```text
   DSH_PET_ELECTRON_PATH=D:\path\to\electron.exe
   ```

3. 推到 Git 后改用 Git 安装：pnpm 会正常安装本包依赖，不需要手动 `npm install`。

改完**重启桌面应用**（宿主半边模块已被加载/缓存；只刷新页面不够）。

---

## 10. 已知限制

- 官方桌面端没有向插件暴露建窗能力，桌面形态仍是独立 Electron 进程（与上游一致）；
- 从 Git 安装会拉整个仓库（含 100MB+ 素材），比 npm 包慢；
- 适配包内置的是发布版 0.3.7 构建产物，不含 main 分支未发布的改动；
- 健康检查路由与桌宠路由一样只监听本机、走 DSH 自身的登录态，不额外做鉴权；
- 上游「桌面 helper 在官方桌面端秒崩」的根因（issue #98）未在上游闭环；适配层能做的是提前暴露环境风险、失败降级，不伪造根因修复。

---

## 11. 版本记录

**`0.3.7-desktop.5`**（2026-10-17）

- **时段感知**：碎碎念/对话按当前时间说话。上游 0.3.7 只把【当下】写进 system，泛指令下模型常忽略（实测深夜仍会说「中午吃啥」）；本版在 system 的背景行补硬约束「内容必须合乎当前时段」，并在碎碎念的**用户指令**末尾直接带「现在是深夜 23:26，这句话要符合这个时段：深夜/晚上别问中午吃什么，早上别聊晚饭」。

**`0.3.7-desktop.4`**（2026-10-17）

- **鼠标在动 → 待机链主动加动作**：鼠标 2.5s 内动过时，待机随机链每 18~28 秒强制抽一段「动作」分类播放（像在陪着干活）；鼠标静下来就退回原有权重抽签。桌面 helper 的穿透小窗收不到窗外鼠标，改由主进程按**全局光标**判定（250ms 限流）经 IPC 通知渲染端；浏览器 overlay 直接监听 `window pointermove`。只影响随机链，拖拽/点播/事件动画不变。

**`0.3.7-desktop.3`**（2026-10-17）

- 默认只显示**一只**：打包默认配置的 `pets[0].display` 由 `both` 改为 `desktop`（仅窗口外透明小窗）。四档仍在、能力不变，设置页或配置文件随时可切回 `web` / `both`。
- 仓库收窄到「只做官方桌面端适配」：移除上游的素材生成链、提示词、API 文档、生态清单、源码与开发工具，相关文档一律指向上游 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。
- 文案改为**非原创声明**：本仓库是上游的二次创作，不主张任何原创性。

**`0.3.7-desktop.2`**（2026-10-17）

- 拖拽跟手补丁：`SPRING_K/SPRING_C` 200/30 → 800/50（`lib/client.js` + 桌面共享逻辑），稳态滞后 `0.15×光标速度` → `0.0625×光标速度`；只影响拖拽跟随，抛掷/反弹/摩擦/挤压不变。
- `npm test` 增加补丁生效断言；`vendor-manifest.json` 记录两处新补丁与逐文件 SHA-256。

**`0.3.7-desktop.1`**（2026-10-17）

- 首个适配发行版：仓库根即 bundle（免构建），内置上游 0.3.7 构建产物，补 `0.2.1-rc.1` 兼容声明、健康检查与初始化失败降级，`@electron/get` 按需加载。

---

## 12. 为什么桌面上有两只桌宠，怎么只留一只

`pets[i].display` 只决定**这只宠物在哪渲染**，四档都在，能力一一对应、没有删减：

| display | 渲染位置 | 能否拖出应用窗口 |
| --- | --- | --- |
| `desktop`（**本发行版默认**） | 仅窗口外透明置顶小窗 | 可以，还能盖在应用窗口上方 |
| `both`（上游默认） | 应用内 overlay + 窗口外透明小窗，**各一只** | 窗口外那只可以；应用内那只不行 |
| `web` | 仅应用内（网页 DOM） | 不能——DOM 元素出不了窗口 |
| `none` | 不显示 | — |

两只彼此**独立**：位置、动作、拖拽都不同步（同一份配置、两个渲染端），所以同时开 `both` 看起来像"两个宠物"。本发行版默认 `desktop`，只出现一只。

改法（改完**重启桌面应用**生效——client 半边只在页面加载时读一次配置）：

- 设置页「桌宠配置 → 显示位置」，或
- `$DSH_HOME/dsh-pet/main-config.jsonc` 里把 `"display"` 改成 `desktop` / `web` / `both` / `none`。

> **桌面形态没有功能缺失**：右键菜单（打开网站 / 打开 DeepSeek Harness、查看余额、碎碎念、对话、回到初始位置、重载配置、动作点播）、拖拽甩抛、余额、碎碎念与对话、工作状态联动、系统通知、多开、pet pack 全部可用；`display` 只影响"在哪画"，不影响任何能力。

---

## 13. 鼠标在动时自动加动作（陪伴模式）

用户在动鼠标（= 坐在电脑前忙）时，宠物不会只播待机呼吸，而是**每隔一会儿主动来一段「动作」**：

| 项 | 值 | 说明 |
| --- | --- | --- |
| 活动窗口 | 2.5s | 鼠标 2.5s 内移动过才算"人在" |
| 冷却 | 18~28s（随机） | 两次主动加动作的最小/最大间隔 |
| 行为 | 强制 `action` 分支 | 跳过本轮 idle/turn/move 抽签，按分类权重抽一段「动作」 |
| 合并方式 | 与现有待机链同一套 | 播完 → `ended` → 继续原来的随机链，不新增模式 |

- 鼠标静下来超过 2.5s → 完全退回上游原有权重抽签（idle 10 / turn 5 / move 5 / 动作 80）。
- 桌面 helper 的窗口是点击穿透小窗、收不到窗外 `mousemove`，所以由主进程按**全局光标**轮询判定（250ms 限流），经 `pet:mouse-activity` IPC 通知渲染端；浏览器 overlay 直接监听 `window pointermove`。
- 只命中**随机链**：拖拽跟随、右键点播、余额/碎碎念/工作状态等事件动画完全不受影响。
- 日志里能看到命中：`[dsh-pet] ... roll=... -> [小动作] 打哈欠`——分类名不是 `IDLE` / `TURN` / `MOVES` 即说明这次是主动加动作。

---

## 14. 时段感知（早上 / 中午 / 晚上 / 深夜）

碎碎念与对话都会自动带上"当前是什么时候"，避免半夜说「中午吃什么」：

- **时刻与时段**：`time-context.ts` 按起始小时分档——凌晨 0–4 / 清晨 5–6 / 早上 7–8 / 上午 9–10 / 中午 11–12 / 下午 13–16 / 傍晚 17–18 / 晚上 19–22 / 深夜 23。system 里会写「【当下】2026年10月17日星期六 23:26，深夜，周末」。
- **硬约束**：system 追加「内容必须合乎当前时段——现在是深夜，不要提其它时段才发生的事（例如深夜别问『中午吃什么』、早上别聊晚饭）」。
- **指令直给**：碎碎念的用户指令末尾再带一句「（现在是深夜 23:26，这句话要符合这个时段）」，模型对紧邻指令的权重更高。
- 每次生成都重新取 `new Date()`，不需要刷新机制；模型调用失败回落逻辑不变。
