# Spolyric

把 **Spotify 正在播放的歌**送到 **Folia 的舞台**：歌名、歌手、封面、进度和歌词都跟着 Spotify 走，画面和动效由 Folia 自己渲染。它不播放音频，也不改 Folia 的文件；走的是 Folia 官方 Stage API 的「接入外部播放器」。

```
                    ┌─ Web API（应用 owner 要有 Premium）
Spotify 播放中 ─────┤
                    └─ 本机媒体会话 SMTC（Windows，免费账号可用）
                              │
                         Spolyric
                              │ POST /stage/lyrics
                              │ POST /stage/lyrics/clock
                              ▼
                  Folia 舞台（舞台模式 · Stage API）
```

当前版本 **0.1.12**，下载见 [Releases](https://github.com/NeverNG/spolyric/releases)。

## 快速开始

**装成 Folia 模组（推荐）**

1. Folia → 设置 → 连接与集成 → 打开「舞台模式」，来源选 **Stage API**；
2. Folia → 设置 → 模组 → 打开「社区模组」，把 [spolyric-0.1.12.zip](https://github.com/NeverNG/spolyric/releases/download/v0.1.12/spolyric-0.1.12.zip) 拖进面板，或把 `spolyric` 文件夹放进 `%APPDATA%\Folia\mods`；
3. 在模组列表里启用 Spolyric（会弹一次确认），再进入舞台。

Spolyric 会启动独立的 Node 运行时，按 Folia 的规则属于「外部作品」：在 **Awesome-Folia** 登记，从本仓库 Releases 安装，不经过 Folium 签名；问题也反馈到本仓库。

Windows + Spotify 桌面端在放即可。免费账号不需要登录 Spotify，也不需要会员。

**从源码运行**

```powershell
npm install
npm run build
.\spolyric.cmd run
```

日志出现 `following 歌名 — 歌手` 就是接上了。

## 两种来源

| | `local`（本机媒体会话） | `web`（Spotify Web API） |
| --- | --- | --- |
| 账号 | 免费账号可用 | 应用 owner 要有 Premium |
| 设备 | 这台电脑上的 Spotify 桌面端 | 任意设备（手机 / 网页 / 其他电脑） |
| 登录 Spolyric | 不需要 | 需要 |
| 进度 | SMTC 时间轴（1–3 秒采样，已平滑） | `progress_ms`（含往返补偿） |

默认 `auto`：先试 Web API，被拒后自动切到本机媒体会话。免费账号直接用 `run`（auto）或 `run --source local`；**不要在免费账号上用 Web API**——能登录，但每个请求都会 403。

需要跟随手机 / 网页时，才配置 Web API：

1. <https://developer.spotify.com/dashboard> 新建应用，Redirect URI 填 `http://127.0.0.1:9888/callback`；
2. `.\spolyric.cmd login --client-id <ClientID>`；
3. `.\spolyric.cmd run --source web`。

只申请 `user-read-playback-state`、`user-read-currently-playing` 两个只读权限。

## 功能

- **封面**：`local` 先用 Spotify 自己的媒体会话缩略图，拿不到再按标题 / 歌手 / 时长在 iTunes、QQ 音乐、酷狗、Deezer 匹配；`web` 直接用 Spotify 封面。封面由本机 `127.0.0.1` 的只读服务提供给 Folia（Stage API 只收 http(s) 地址）。
- **歌词**：Spotify 官方歌词要求**应用 owner 有 Premium**；免费账号即使登录，Spotify 的 Web API / 歌词接口仍会 403，只能用目录源（网易云 / QQ / 酷狗 / LRCLIB，通常是简体）。有权限时优先 Spotify 歌词；`--prefer` 改首选源；繁转简只用于搜索 / 匹配，不改歌词原文。所有来源都没有就只显示曲目，不编造。
- **广告**：按标题 / 歌手 / 时长识别（例如「無廣告收聽音樂。」）。广告期间不清空舞台、不显示广告信息，保留当前歌曲的封面和标题；进度条按广告自己的时长从 0 读秒，Folia 的视觉动画约 2 秒后继续，广告结束后按歌曲真实位置接回歌词。识别偶尔会漏，漏掉时按普通曲目处理。
- **控制**（仅 `local`）：舞台的播放 / 暂停 / 拖动会作用到 Spotify。上一首 / 下一首用模组进度条两端的 `⏮` / `⏭`、快捷键 `Ctrl+Alt+←` / `Ctrl+Alt+→` / `Ctrl+Alt+空格`，或 `spolyric key next|prev|play-pause`。`web` 模式只读，不会动别的设备。
- **时间同步**：每 0.5 秒采样；暂停 / 继续和超过 1.5 秒的拖动立刻校时；小漂移交给 Folia 自己外推；切歌用新会话；停止播放等 20 秒才清空舞台。

歌词整体偏早 / 偏晚时，用 `--offset <毫秒>` 平移（正数延后、负数提前），不用改文件。

## 命令

| 命令 | 作用 |
| --- | --- |
| `spolyric run` | 跟随 Spotify 并推送到 Folia 舞台（默认 auto） |
| `spolyric run --source local` | 强制用本机媒体会话（Windows，不需登录） |
| `spolyric run --source web` | 强制用 Web API（需要 Premium 应用） |
| `spolyric run --once` | 只跑一步就退出 |
| `spolyric run --dry-run` | 不推送，只打印将要推送的内容 |
| `spolyric key next\|prev\|play-pause` | 控制本机 Spotify，不需要 Folia 在跑 |
| `spolyric status [--json]` | 看来源、Folia 连接、舞台模式和正在播什么 |
| `spolyric login --client-id <ID>` | 登录 Spotify（仅 Web API 需要） |
| `spolyric logout` | 忘掉本机保存的登录 |
| `spolyric config [--json]` | 显示设置文件与最终生效的设置 |

常用选项：`--source <auto|web|local>`、`--poll <ms>`（默认 500）、`--clock <ms>`（默认 60000）、`--prefer <qq|netease|kugou|spotify|lrclib>`（默认 spotify；未登录时自动跳过 Spotify）、`--offset <ms>`、`--lyrics <逗号分隔>`、`--no-control`、`--connection <path>`、`--stage-url <url>` / `--stage-token <tok>`、`--verbose`。对应的环境变量是 `SPOLYRIC_*`，见 `src/config.ts`。

## 代理

Node 的 `fetch` 不读系统代理，Spolyric 自己按顺序找：

1. `SPOLYRIC_PROXY`（`none` 表示直连）；
2. `HTTPS_PROXY` / `ALL_PROXY` / `HTTP_PROXY`；
3. Windows 系统代理（注册表 `ProxyEnable` + `ProxyServer`）。

`spolyric status` 的「代理」一行会写当前用的是哪个。走代理时请求经 CONNECT 隧道发出。

## 排错

| 现象 | 处理 |
| --- | --- |
| `Active premium subscription required for the owner of the app` | 免费账号的 Web API 403。改用 `run`（auto）或 `run --source local` |
| 舞台没反应 | 确认「舞台模式」已开、来源是 **Stage API**，并进入舞台；`spolyric status` 会写明缺哪一步 |
| `还没有读到 Folia 的 Stage 连接文件` | 同上；`status` 会列出查过的路径 |
| `local` 模式一直「没有在播放」 | Spotify 桌面端要在放（不是手机），且 SMTC 当前会话是 Spotify |
| Folia 显示简体，Spotify 里是繁体 | Spotify 官方歌词要求应用 owner 有 Premium；免费账号登录也会 403，显示的是网易云 / QQ 的简体歌词。有 Premium 账号时用它新建 Spotify 应用并 `spolyric login`；没有就接受目录源 |
| 舞台按钮没反应 | 只在 `local` 模式有效；`web` 不动别的设备；日志里应有「Folia 的暂停键 → Spotify 已暂停」 |
| `login` 超时或端口被占 | Redirect URI 要和日志里一字不差；9888 被占时用 `--port 9899` 并同步改应用里的地址 |

调试三板斧：

```powershell
.\spolyric.cmd status --json
.\spolyric.cmd run --once --verbose
.\spolyric.cmd run --dry-run --verbose
```

## 隐私与限制

- 只申请两个只读权限；`local` 模式完全不需要登录，也不联网读 Spotify；
- Spotify token 只存本机，日志不打印；Folia 的 Stage token 只在内存里用；
- 登录用的 `127.0.0.1:9888` 只在登录那一次打开；
- `local` 只能跟随这台 Windows 电脑上的 Spotify 桌面端；手机播放需要 Web API（应用 owner 要有 Premium）；
- 免费账号无法让任何第三方程序替 Spotify「播放」音频——Spolyric 只做跟随和显示；
- 播客和本地文件的歌词只能靠歌词源按标题 / 歌手匹配，通常只有 LRCLIB 能命中；
- 舞台模式下 Folia 的播放控制对 Stage API 是只读的，Spolyric 通过「舞台状态变化」反推按键。

## 装成 Folia 模组（开发）

```powershell
npm run mod      # 生成 dist-mod/spolyric/ 和 dist-mod/spolyric.zip
```

模组的 `mod.json` 没有权限要求。`main.cjs` 用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 启动 `runtime/src/main.js run`，把日志转发到模组面板；`runtime/` 是编译后的 `dist/src`（含 PowerShell 采样 / 控制脚本和封面辅助程序），数据仍在 `%APPDATA%\Spolyric`。单实例锁在 `%APPDATA%\Spolyric\run.lock`：如果终端里已经有一个 `spolyric run`，模组里的那份会退出——装模组前先停掉终端里的。

## 开发

```powershell
npm run build     # tsc → dist/
npm test          # node:test，178 个用例
npm run mod       # 打包成 Folia 模组
npm run check     # build + test
```

| 位置 | 作用 |
| --- | --- |
| `src/cli/` | 参数与命令（login / run / status / logout / config） |
| `src/spotify/` | PKCE 登录、Web API 读取、歌词解析、缓存 |
| `src/media/` | Windows 媒体会话：PowerShell 采样 / 控制脚本、读取器、平滑时钟 |
| `src/folia/` | Stage 连接文件与 Stage API 客户端 |
| `src/sync/` | 来源选择、同步引擎（一次 `tick` 决定推什么）、长跑循环 |
| `test/` | 单元测试 + 真 socket 集成测试 |
| `docs/ARCHITECTURE.md` | 设计取舍、状态机、错误恢复、测试策略 |

`reference/` 是 Folia 与 Lyricify 的参考快照，只用于查协议和文案，不参与构建。

## 致谢

- [Folia](https://github.com/chthollyphile/folia-major)：舞台、歌词渲染与 Stage API 文档；
- [Lyricify](https://github.com/WXRIW/Lyricify-App)：免费账号跟随本机播放器的思路；
- [LRCLIB](https://lrclib.net)：免费歌词库。

许可证：MIT。
