# 额外动作（自定义动画）

本目录存放**本仓库额外收录**的桌宠动作素材（不属于上游包内那 106 段）。目录约定与上游保持一致：

```text
animations/
└─ webm/
   └─ 非洲之心.webm        # 640×360 · 24fps · VP9 + alpha（10.0s）
```

## 约定（与上游同一套）

上游在两处放动画素材，结构完全一样——「一个 `webm/` 目录 + 文件名即动作名」：

| 位置 | 用途 |
| --- | --- |
| `dsh-pet/assets/webm/`（上游包内） | 出厂自带的 106 段动画 |
| `$DSH_HOME/dsh-pet/main-animation/webm/`（用户层） | 用户自己加的动画，**优先级更高** |

所以这里也用 `webm/` 子目录：

- **文件名 = 动作名**（不含扩展名），中文、空格都行；配置里写的就是这个名字；
- **唯一格式 `.webm`**：VP9 + alpha（`yuva420p`），Chromium / Electron 直接透明播放；Safari 用的 HEVC `.mov` 见上游；
- **画布 640×360**，角色居中、脚底线在 y≈330，四周留透明边（桌宠按 16:9 等比缩放）。

## 怎么让桌宠用上

1. 把 `.webm` 复制到用户素材目录（优先级高于包内素材）：

   ```text
   %USERPROFILE%\.dsh\dsh-pet\main-animation\webm\非洲之心.webm
   ```

2. 在 `%USERPROFILE%\.dsh\dsh-pet\main-config.jsonc` 的 `animations.categories` 里登记名字，例如加进「小动作」：

   ```jsonc
   { "id": "小动作", "weight": 20, "actions": ["…", "非洲之心"] }
   ```

3. 让桌宠重载配置：右键桌宠 →「重载配置」（或重启桌面应用）。

   然后 **右键 → 动作 → 小动作 → 非洲之心** 即可点播；它同时也会进入待机随机链与「鼠标活动主动加动作」的候选池。

> ⚠️ `animations` 是**整段替换**语义：用户配置里一旦写了 `animations`，就要写全。最稳的做法是把包内默认
> `dsh-pet/assets/config.jsonc` 整份复制到用户配置再改（设置页「同步」也能生成这份完整文件）。

## 现有素材

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `webm/非洲之心.webm` | 用户自制的 AI 绿幕视频（豆包，1280×720 → 640×360） | 开保险箱、捧起钻石的 10 秒动作；已去水印、去音频、绿幕抠成 alpha |

## 新增一个动作（给以后参考）

源视频要求（与上游提示词一致）：16:9、绿幕背景、角色位置固定、动作首尾尽量正面站立、10 秒左右。

转换要点（ffmpeg 7.x，libvpx-vp9 的 alpha 编码必须新版本才支持）：

```sh
ffmpeg -i 源.mp4 -an \
  -vf "delogo=水印区域,scale=640:360:flags=lanczos,format=rgba,\
geq=r='r(X,Y)':g='min(g(X,Y),max(r(X,Y),b(X,Y)))':b='b(X,Y)':a='if(lt(X,290)*lt(Y,118),0,if(lt(0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y),95),255,clip(255*(1-(g(X,Y)-max(r(X,Y),b(X,Y))-2)/14),0,255)))',\
format=yuva420p" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -auto-alt-ref 0 -row-mt 1 目标.webm
```

这套参数是踩过坑的版本（首版边缘发绿、保险箱门缝被抠穿）：

| 处理 | 作用 |
| --- | --- |
| `d = g - max(r,b)` 软阈值：`d ≥ 16` 全透明、`d ≤ 2` 不透明 | 绿幕（灰绿渐变）抠掉；阈值比"6/24"更狠，边缘残绿基本消失 |
| `g' = min(g, max(r,b))`（在 geq 里做） | 去绿色反光/绿边（despill），比 `despill` 滤镜安全 |
| 暗部保护：`luma < 95` 强制不透明 | 保住保险箱的暗色反光、门缝、金色描边的过渡像素，不被抠成洞 |
| 左上角固定清空：`x<290 且 y<118` 时 alpha=0 | 水印残留（`delogo` 插值后仍有极淡残影）直接清成透明 |
| `delogo=...:enable='between(t,a,b)'` | 水印会在画面上移动，按时间段分两处修 |

- 绿幕不是纯绿时，用上面这条「绿色优势」算 alpha，比 `chromakey` 干净；
- **不要用 `despill` 滤镜**：它会让整条链丢掉 alpha（实测）；
- `-auto-alt-ref 0` 是 VP9 alpha 的必要条件；
- 验证：`ffmpeg -c:v libvpx-vp9 -ss 5 -i 目标.webm -frames:v 1 out.png`，PNG 带 alpha 才是对的（原生 vp9 解码器不读 alpha）。
