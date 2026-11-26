# Spolyric

把 **Spotify 正在播放的歌** 送到 **Folia 的舞台**：标题、进度、逐行歌词都同步过去，画面和动效全部是 Folia 自己的。Spotify 负责播，Folia 负责好看。

```
                       ┌─ Web API（需要应用 owner 有 Premium）
Spotify 播放中 ────────┤
                       └─ 本机媒体会话 SMTC（Windows，免费账号可用）
                                   │
                              Spolyric
                                   │  POST /stage/lyrics
                                   │  POST /stage/lyrics/clock
                                   ▼
                        Folia 舞台（舞台模式 · Stage API）
```

---

## 先说清楚两件事

**1. 没有任何第三方程序能让免费账号「播放」Spotify 音频**（Lyricify 也不行）。Premium 限制的是音频密钥，不是歌词显示。

**2. Spotify 现在要求「开发者应用的 owner 本人有 Premium」才允许该应用调用 Web API。** 免费账号即使登录成功，`/v1/me/player`、`/v1/me`、`/search` 都会返回：

```
Active premium subscription required for the owner of the app.
```

所以对免费账号，唯一可行、也正是 Lyricify 对免费账号用的那条路是：**读本机 Spotify 客户端在 Windows 媒体会话（SMTC）里报的曲目、进度和播放状态**。Spolyric 两种来源都支持，`auto` 会先试 Web API，被拒就自动切到本机媒体会话。

| 你的情况 | 用哪个来源 |
| --- | --- |
| Spotify 免费账号 | `local`：本机 Spotify 客户端在放，Spolyric 读 SMTC（默认 auto 会自动选它） |
| Spotify Premium，想让 Folia 自己播 | 不需要 Spolyric：Folia 内置的 Spotify 音源本来就能播（librespot / Soloist） |
| Premium，歌在手机上放、电脑上看 | 需要 `web` 模式（建自己的 Spotify 应用并登录） |
| 免费账号，歌在手机上放 | 做不到：SMTC 只在本机，Web API 又要求应用 owner 有 Premium |

Spolyric 不改 Folia 的任何文件，也不需要 Electron 构建；它走 Folia 官方 Stage API 的「接入外部播放器」接口，所以 Folia 升级后照样能用。

---

## 快速开始（免费账号 / 本机 Spotify）

1. **Folia**：设置 → 连接与集成 → 打开 **「舞台模式」** → 来源选 **Stage API**。
2. **Spotify 桌面端**：登录并开始播放（Spolyric 读的是本机客户端的媒体会话）。
3. **运行**：

   ```powershell
   cd D:\test1\Spolyric
   npm install
   npm run build
   .\spolyric.cmd run
   ```

   日志应出现：

   ```
   播放状态来源：auto（先 Web API，被拒后转本机媒体会话）
   following 歌名 — 歌手
   ```

   如果一开始没有登录过 Spotify，`auto` 会直接用本机媒体会话，不会再报 403。

不想先跑真的 Spotify？用演示数据（假 Spotify + 假歌词库，90 秒换一首）：

```powershell
npm run build
node scripts/demo.mjs
```

---

## Web API 模式（可选，需要 Premium）

只有当你本人有 Premium、并且想让 Spolyric 跟随**任意设备**（手机、网页）的播放时才需要。

1. <https://developer.spotify.com/dashboard> → **Create app**，Redirect URI 一字不差填：

   ```
   http://127.0.0.1:9888/callback
   ```

2. 复制 **Client ID**，然后：

   ```powershell
   .\spolyric.cmd login --client-id 你的ClientID
   .\spolyric.cmd run --source web
   ```

Spolyric 只申请两个只读权限：`user-read-playback-state`、`user-read-currently-playing`。

> 免费账号不要走这一步：登录会成功，但每个请求都会 403（见上面第 2 条）。直接用 `run`（auto）或 `run --source local`。

---

## 两种来源的差别

| | `local`（本机媒体会话） | `web`（Spotify Web API） |
| --- | --- | --- |
| 账号要求 | 免费账号可用 | 应用 owner 要有 Premium |
| 播放设备 | 必须是这台电脑上的 Spotify 桌面端 | 任意设备（手机 / 网页 / 其他电脑） |
| 需要登录 Spolyric | 不需要 | 需要 |
| 进度来源 | SMTC 时间轴（1–3 秒采样，已平滑） | `progress_ms`（含往返补偿） |
| 广告 | 无法识别，按普通曲目处理 | 识别到广告会清空舞台 |
| 封面 | 按标题/歌手/时长在 iTunes、Deezer 匹配（本地缓存） | 有专辑封面 |
| 歌词 | LRCLIB（按歌名/歌手匹配） | Spotify 官方歌词优先，LRCLIB 兜底 |

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `spolyric run` | 跟随 Spotify，往 Folia 舞台推送（默认 auto） |
| `spolyric run --source local` | 强制用本机媒体会话（Windows，不需要登录） |
| `spolyric run --source web` | 强制用 Web API（需要 Premium 应用） |
| `spolyric run --once` | 只跑一步就退出（没有 Folia 也会直接返回） |
| `spolyric key next\|prev\|play-pause` | 控制本机 Spotify，不需要 Folia 在跑 |
| `spolyric run --prefer qq` | 优先用哪个歌词源（默认 qq，和 Folia 一样） |
| `spolyric run --offset <ms>` | 歌词整体平移（正数延后、负数提前） |
| `spolyric run --dry-run` | 不推送，只打印将要推送的内容 |
| `spolyric status` | 看来源、Folia 连接、舞台模式、正在播什么 |
| `spolyric status --json` | 机器可读 |
| `spolyric login --client-id <ID>` | 登录 Spotify（仅 Web API 模式需要） |
| `spolyric logout` | 忘掉本机存着的登录 |
| `spolyric config [--json]` | 显示设置文件与最终生效的设置 |

常用选项：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--source <auto\|web\|local>` | auto | 播放状态来源 |
| `--no-control` | 关 | 关闭「舞台按钮控制本机 Spotify」 |
| `--poll <ms>` | 1500 | 多久采样一次 |
| `--clock <ms>` | 4000 | 多久给 Folia 校一次时间 |
| `--lyrics spotify,lrclib` | 两个都开 | 歌词来源（local 模式实际只会用 LRCLIB） |
| `--connection <path>` | 自动找 | Folia 的 `stage/connection.json` |
| `--stage-url <url>` / `--stage-token <tok>` | — | 直接指定 Stage API |
| `--verbose` | 关 | 详细日志 |

环境变量：`SPOLYRIC_SOURCE`、`SPOLYRIC_CLIENT_ID`、`SPOLYRIC_HOME`、`SPOLYRIC_FOLIA_DATA`、`SPOLYRIC_CONNECTION`、`SPOLYRIC_STAGE_URL`、`SPOLYRIC_STAGE_TOKEN`、`SPOLYRIC_PROXY`（`none` 表示直连）、`SPOLYRIC_SPOTIFY_API_BASE`、`SPOLYRIC_SPOTIFY_LYRICS_BASE`、`SPOLYRIC_LRCLIB_BASE`、`SPOLYRIC_VERBOSE=1`。

---

## 代理

Node 的 `fetch` **不读系统代理**。Spolyric 会自己找：

1. `SPOLYRIC_PROXY`（`none` 强制直连）；
2. `HTTPS_PROXY` / `ALL_PROXY` / `HTTP_PROXY`；
3. Windows 系统代理（注册表 `ProxyEnable` + `ProxyServer`）。

`spolyric status` 的「代理」一行会写当前用的是哪个。走代理时请求通过 CONNECT 隧道发出。

---

## 时间同步：为什么歌词不会飘

| 情况 | 处理 |
| --- | --- |
| 正常播放 | 每 0.5 秒采样一次；Web 模式按往返时间补偿，local 模式把 SMTC 的采样颗粒平滑掉 |
| 暂停 / 继续 | 立刻推一次时钟（`paused` 变化） |
| 拖动进度 | 位置和 Folia 的推算差超过 1.5 秒，立刻推 |
| 慢慢漂移 | 基本不补：Folia 自己按时间外推；只有差超过 5 秒（例如电脑睡眠回来）才补一次 |
| 切歌 | 新会话（新 `sessionUpdatedAt`），上一首的时钟不会用到下一首 |
| 停止播放 | 先等 20 秒（切歌瞬间可能读不到），还空着才清空舞台 |

歌词整体偏早/偏晚，用 `--offset <毫秒>` 平移（正数延后、负数提前），不用改任何文件：

```powershell
.\spolyric.cmd run --offset 300     # 歌词比现在晚 0.3 秒
.\spolyric.cmd run --offset -200    # 歌词比现在早 0.2 秒
```

Spolyric 只清空**自己推的那次会话**；舞台被别人接手时会退让一分钟，不抢。

---

## 歌从哪来、词从哪来

- `local`：PowerShell 读 SMTC（`src/media/readSession.ps1`），得到标题、歌手、专辑、时长、进度和播放状态；只认 `app` 里带 `Spotify` 的会话，别的播放器不抢舞台。
- `web`：`GET /v1/me/player`，403 时再试 `/v1/me/player/currently-playing`；仍然 403 就把 Spotify 的原话带进日志。
- 封面：`web` 用 Spotify 自带封面；`local` 的 SMTC 拿不到缩略图（PowerShell 5.1 的 WinRT 投影限制），改为按 **标题 + 歌手 + 时长** 在 iTunes / QQ 音乐 / Deezer 里匹配（QQ 用专辑 mid 取同一张专辑图，中文歌命中率高），下载后由 Spolyric 起一个**只监听 `127.0.0.1` 的小 HTTP 服务**提供 http 地址（Folia 只接受 http(s) 封面，且它自己不用联外网）。匹配很谨慎：标题要一致，歌手或时长至少一项对得上；匹配不到就不放封面，不瞎配。封面缓存在 `%APPDATA%\Spolyric\covers\`。
- 歌词：**首选源优先，其余按 Folia 的顺序**。首选源默认 `qq`（和 Folia 默认一致），也可以设成 `netease` / `kugou` / `spotify` / `lrclib`；顺序是「首选源 → 网易云 → QQ → 酷狗 → Spotify → LRCLIB」，第一个有匹配的就用。都没有就只显示曲目，不编造。
  来源可关：`--lyrics spotify,netease,qq,kugou,lrclib` 任选；`--prefer kugou` 或 `SPOLYRIC_PREFER=netease` 调优先级。
- 歌词缓存：`%APPDATA%\Spolyric\lyrics-cache\`；只有所有来源都明确说「没有」才缓存这个结论（6 小时），网络错误不缓存。

---

## 控制播放：Folia 舞台的按钮现在能用

local 模式（Windows + 本机 Spotify）下，**两个方向都同步**：

- 在 **Spotify** 里播放/暂停 → Folia 舞台的播放状态在约 1–2 秒内跟上；
- 在 **Folia** 舞台按播放/暂停 → Spotify 跟着变；
- **拖动进度条** → Spotify 跳到那个位置；
- 上一首 / 下一首：Folia 在「舞台 + Stage API」这个上下文里把这两项关掉了（`controlCapabilities.previous/next = false`），所以它自带的按钮不生效。Spolyric 补了三个入口：
  - 模组在**进度条两端**加的 `⏮` / `⏭` 小按钮（只在舞台模式下生效）；
  - 全局快捷键：`Ctrl+Alt+←` 上一首、`Ctrl+Alt+→` 下一首、`Ctrl+Alt+空格` 播放/暂停；
  - 命令行：`spolyric key next|prev|play-pause`（不需要 Folia 在跑）。

原理：Folia 对 Stage API 输入是**只读**的——按暂停只会停住舞台自己的时钟，下一次时钟推送还会把它拉回去。Spolyric 每轮读 `GET /stage/player/status`（Folia 每秒发布一次舞台状态）：

- 舞台状态**发生变化**（PLAYING↔PAUSED）且和 Spotify 相反 → 当作你按键，用 SMTC 给本机 Spotify 发 `play` / `pause`；
- 舞台状态只是**持续不一致**（没有变化，例如卡在暂停）→ 不当作按键，反过来用 Spotify 的状态把它校正（这就是「Spotify 暂停没同步到 Folia」的修复）；
- 状态一致、位置差 > 2.5 秒 → 发 `seek`（`TryChangePlaybackPositionAsync`）。

命令走 `src/media/controlSession.ps1`，和读取用的是同一套 WinRT 接口（`TryPlayAsync` / `TryPauseAsync` / `TryChangePlaybackPositionAsync`）。这个脚本是**常驻**的：第一次启动约 0.4 秒，之后一条命令只要几毫秒，所以按暂停/继续的延迟主要在 Folia 每秒发布一次舞台状态上。

代价与细节：

- 按键要**确认一轮**（约 0.6–1.6 秒）：换歌、重建窗口时的单个过期 PAUSED 快照不会触发暂停；
- 有 **1–2 秒延迟**：Folia 的状态每秒发布一次，命令本身约 0.3–0.6 秒；
- 控制脚本自己 4 秒超时，命令串行执行，不会因为卡住而堆一堆 PowerShell；
- 只对 `local` 生效；`web` 模式不会去动别的设备；
- 漂移校正不再携带 `paused`，所以不会把你按下的暂停又「恢复」；
- 不想要这套控制：`spolyric run --no-control`（或 `SPOLYRIC_CONTROL=off`），Spolyric 就只显示、不控制。

---

## 装成 Folia 模组（随 Folia 启动，不用单独开程序）

**这个模组是给免费 Spotify 账号用的跟随器**：跟着 Windows 上 Spotify 桌面端正在放的歌，把歌名、进度和歌词送到 Folia **舞台**；不需要会员，也不需要在这个模组里登录 Spotify，它自己不出声。

两点必须说清楚：

- **必须打开舞台模式**：Folia → 设置 → 连接与集成 → 打开「舞台模式」，来源选 `Stage API`，再进舞台。普通播放页、桌面歌词都看不到效果。
- **它和 Folia 内置的「Spotify」音源不是一回事**：内置音源要在 Folia 里登录并负责播放（免费账号会提示需要会员）；这个只在后台跟随 Spotify 桌面端，效果只出现在舞台。免费账号请把内置音源关掉，不要两个同时用。

Folia 的模组可以有一个 **main 入口**，它跑在 Folia 的主进程里、能 require Node 模块和启动外部程序。Spolyric 就借这一点把自己打包成模组：

```
npm run mod      # 生成 dist-mod/spolyric/ 和 dist-mod/spolyric.zip
```

安装（二选一）：

1. Folia → 设置 → 模组 → 打开「社区模组」→「打开模组目录」（Windows 上是 `%APPDATA%\Folia\mods`）→ 把 `spolyric` 文件夹拷进去；
2. 或者把 `dist-mod/spolyric.zip` 直接拖到模组面板上。

然后在模组列表里**启用 Spolyric**（会弹一次确认）。之后启动 Folia 就会自动拉起 Spolyric；禁用模组或退出 Folia 时，子进程随之结束。

工作方式：

- `mod.json` 只有 `main: "main.cjs"`，没有权限要求；
- `main.cjs` 用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 启动 `runtime/src/main.js run`（就是同一个 CLI），把日志转发到模组面板；
- `runtime/` 是编译后的 `dist/src` 和两个 `.ps1`，数据仍在 `%APPDATA%\Spolyric`；
- 单实例锁：`%APPDATA%\Spolyric\run.lock`。如果已经手动开着一个 `spolyric run`，模组里的这份会退出，不会两边抢舞台——装模组之前先把终端里的停掉。

前提和平时一样：Folia 打开舞台模式、来源选 `Stage API`；Windows + Spotify 桌面端。

本仓库已经把它装到 `%APPDATA%\Folia\mods\spolyric`，你只需要在模组面板里启用。

---

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `Active premium subscription required for the owner of the app` | 这是 Spotify 对「应用 owner 没有 Premium」的统一 403。免费账号请用 `run`（auto）或 `run --source local`，不要用 Web API |
| `Spotify answered 403`（没有正文） | 先用 `spolyric status --json` 看 `problem`；新版会把 Spotify 的原话带出来 |
| 舞台没反应 | Folia 的「舞台模式」要打开、来源要选 Stage API；`spolyric status` 会写清楚 |
| `还没有读到 Folia 的 Stage 连接文件` | 同上；`status` 会列出查过的路径 |
| local 模式一直是「没有在播放」 | Spotify 桌面端要在放（不是手机），且 SMTC 里当前会话必须是 Spotify；Edge/其他播放器不会被当成 Spotify |
| 歌名乱码 / 没歌词（旧版本） | 已修：Windows PowerShell 5.1 会把无 BOM 的 UTF-8 脚本按 GBK 读、按控制台代码页输出。现在脚本是纯 ASCII 并强制 UTF-8 输出，Node 侧还会对 GBK 字节兜底 |
| local 模式进度慢半拍 | SMTC 本身是 1–3 秒采样；Spolyric 已平滑。整首歌有固定偏移时，用 Folia 的歌词时间偏移微调 |
| 舞台按钮没反应 | 只在 `local` 模式、Windows 上有效；日志里应有「Folia 的暂停键 → Spotify 已暂停」；`web` 模式不会控制设备 |
| 按了暂停/播放，一会儿又变回去 | 已修复：时钟推送现在始终带上 pause 状态，发命令后 5 秒内也不把 Spotify 的旧状态当成变化。旧版 `config.json` 里若还是 4000/900 的老默认值，启动时会自动迁移到 60000/5000 |
| 封面是空的（local 模式） | SMTC 的封面接口在 PowerShell 5.1 里拿不到，暂时用 Folia 自己的背景 |
| `login` 等在浏览器五分钟 | Spotify 应用里的 Redirect URI 和日志里那行不完全一样 |
| `login` 提示端口被占用 | 9888 被占了：`--port 9899`，并把应用里的 Redirect URI 一起改 |

调试三板斧：

```powershell
.\spolyric.cmd status --json
.\spolyric.cmd run --once --verbose
.\spolyric.cmd run --dry-run --verbose
```

---

## 隐私与安全

- 只申请两个只读权限，不控制播放、不改资料、不改库；
- local 模式完全不需要登录，也不联网读 Spotify；
- Spotify token 只在本机，日志与终端输出里都不打印；POSIX 上 0600（Windows 靠用户目录 ACL）；
- Folia 的 Stage token 只在内存里用，不落盘、不打印；
- 不监听常驻端口；登录用的 `127.0.0.1:9888` 只在登录那一次打开。

---

## 限制

- 不能远程控制**别的设备**上的播放；本机 Spotify 的播放/暂停/拖动已经可以用 Folia 舞台的控制条（local 模式，见上文）；
- `local` 模式只能跟随**本机 Windows 上的 Spotify 桌面端**；手机播放需要 Web API（应用 owner 要有 Premium）；
- `local` 模式识别不到广告，会把广告当普通曲目；
- 舞台模式下 Folia 的播放控制是只读的（Stage API 规则）；
- 播客、本地文件的歌词只能靠 LRCLIB 匹配。

---

## 开发

```powershell
npm run build     # tsc → dist/，并把 readSession.ps1 复制过去
npm test          # node:test，164 个用例（含真 socket、代理隧道与假 SMTC 的测试）
npm run mod       # 打包成 Folia 模组（dist-mod/spolyric）
npm run check     # build + test
```

| 位置 | 作用 |
| --- | --- |
| `src/cli/` | 参数与命令（login / run / status / logout / config） |
| `src/spotify/` | PKCE 登录、Web API 读取、歌词（Spotify + LRCLIB + 缓存） |
| `src/media/` | Windows 媒体会话：PowerShell 采样脚本、读取器、平滑时钟的播放器 |
| `src/folia/` | Stage 连接文件与 Stage API 客户端 |
| `src/sync/` | 来源选择、引擎（一次 `tick` 决定推什么）、长跑循环 |
| `test/` | 单元测试 + 真 socket 集成测试 |
| `docs/ARCHITECTURE.md` | 设计取舍、状态机、错误恢复、测试策略 |

`reference/` 里是两个参考项目的快照（Folia、Lyricify），只用于查协议和文案，不参与构建。

---

## 致谢

- [Folia](https://github.com/chthollyphile/folia-major)：舞台、歌词渲染，以及 Stage API 文档；
- [Lyricify](https://github.com/WXRIW/Lyricify-App)：免费账号跟随播放器的思路（它用 Windows 媒体会话控制本机 Spotify）；
- [LRCLIB](https://lrclib.net)：免费歌词库。

许可证：MIT。
