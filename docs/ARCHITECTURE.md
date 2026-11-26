# Spolyric 设计说明

这份文档写给要改 Spolyric 的人：为什么这么接、一次推送里发生了什么、出错时谁负责恢复。

## 1. 目标与约束

目标：让 Folia 显示 **Spotify 正在播放的内容**，保留 Folia 自己的歌词视觉；不要求 Premium。

约束（决定了方案）：

1. **Spotify 不给第三方播放免费账号的音频**。librespot / Soloist / Spotify 自己的 Web 播放器都只在 Premium 下拿得到音频密钥。所以「让 Folia 放音」不可能，只有「让 Folia 显示」。
2. **播放控制需要 Premium**（Spotify Web API 的 play / pause / seek / next / volume 都要求 Premium + 一个在线设备）。免费账号只能在本机客户端的媒体会话里被控制。
3. **Spotify 还要求开发者应用的 owner 本人有 Premium 才允许该应用调用 Web API**。实测（2026-11-25）：免费账号建的应用，`/v1/me`、`/search`、`/v1/me/player` 一律返回 403，正文是 `Active premium subscription required for the owner of the app.`。所以 Web API 对免费账号整条路都不通。
4. **免费账号唯一可行的是本机媒体会话（SMTC）**：Windows 把正在播放的曲目、进度、播放状态暴露给任何本地程序，Lyricify 的免费账号体验就是这条路。Node 不能直接调 WinRT，但可以用 Windows PowerShell 5.1 的 WinRT 投影读出来（`src/media/readSession.ps1`，已在本机实测能读到 Spotify 的曲目与时间轴）。
5. **不修改 Folia**。Folia 是一个 2800+ 文件、带 Dedicatus 规范与生成文档的 Electron 工程；fork 一个「跟随」路由要新增 `PlaybackRoute`、改 `externalPlayback` 的「外来曲目就暂停播放器」逻辑、动 omni 契约与生成文档（见 `reference/folia/src/services/onlineMusic/externalPlayback.ts` 的 foreign-track 分支）。成本高、风险大，而且升级就断。
6. **Folia 已经提供了完全对口的接入点**：Stage API 的「接入外部播放器」——只给曲目、长度、封面和位置，舞台按外部播放器的时间走，Folia 只显示（`reference/folia/test/manual/stage-client/API_SCHEMA.md` 的「接入外部播放器」一节）。

于是方案定为：**一个本地小服务，从「Web API 或本机 SMTC」读播放状态，按 Stage API 推送**。它不碰 Folia 的代码，也不假装自己是播放器。

## 2. 为什么不选另外两条路

| 方案 | 结论 |
| --- | --- |
| fork Folia，新增「跟随」播放路由 | 能拿到播放器内嵌的歌词视图，但要改路由状态机、omni 契约、i18n 四份语言表、Dedicatus 登记与生成文档；且 Folia 的 external 路由在「播放器放了别的歌」时会主动暂停播放器，跟随场景必须反转这条规则。成本/收益不成比例。 |
| 实现 Folia 的 Now Playing WebSocket 服务（`ws://localhost:9863/api/ws/lyric`） | 能让 Folia 设置里直接选「Now Playing」，但协议未文档化，要自己写 WebSocket 服务端（Node 无内置 server），且消息形状只能从 Folia 的客户端代码反推。作为后续可选项保留（见 §10）。 |
| Stage API 推送（本方案） | 官方文档写明为「外部播放器」准备；纯 HTTP；Folia 负责歌词解析、排版、动效；零 Folia 改动。 |

## 2.5 两条来源：Web API 与 SMTC

| | `web` | `local` |
| --- | --- | --- |
| 读取 | `GET /v1/me/player`（403 时退到 `/v1/me/player/currently-playing`，带设备无关的字段） | PowerShell 每 `pollIntervalMs` 输出一行 SMTC JSON |
| 前提 | 应用 owner 有 Premium | Windows + 本机 Spotify 桌面端在放 |
| 强项 | 任意设备、专辑封面、广告识别 | 免费账号可用、无需登录 |
| 弱项 | 免费账号 403 | 只限本机；封面靠目录匹配；SMTC 采样 1–3 秒 |

`source: auto`（默认）在**第一次读取**时试 Web API：
- 成功 → 之后都用 Web API；
- `HttpError` / `SpotifyAuthError` → 记一行 warn（带 Spotify 的原话），永久切到 SMTC。

这个探测是**懒**的：没有 Folia 连接、还没开始跟随的时候不会碰 Spotify，所以 `run --once`、断网、Folia 没开都不会产生意外请求。

SMTC 的采样颗粒：Spotify 每 1–3 秒才更新一次 `Timeline.Position`，同时给 `LastUpdatedTime`。脚本用 `Position + (now - LastUpdatedTime)` 得到「现在」的位置（实测与墙钟连续）。Node 侧再用一个小相位锁：
- 按墙钟推进；
- 只有**采样值变了**才做修正（没变说明没有新信息，不能把时钟拖回去）；
- 差值 > 2.5 秒当作拖动，直接跳；否则吸收 25%。

## 3. 一次推送里发生了什么

```
run()
 ├─ choosePlayer(): auto 先建 Web API 的客户端，第一次读取被拒时切到 SMTC
 └─ 循环（每 pollIntervalMs）
     ├─ connect(): 重读 stage/connection.json → 地址/token 变了就重建 Stage 客户端与引擎
     ├─ checkStageMode(): GET /stage/health，提示「舞台模式 / 来源」是否对
     └─ engine.tick():
         1. 来源（Web API 或 SMTC）给出：track / ad / idle
         2. 判定：track / ad / idle
         3. track：
            a. 与当前会话同一首？否 → begin()
               - 有磁盘歌词缓存 → 直接带 lyricSource 推送
               - 没有 → 先推「只有曲目」的会话（立刻有画面），后台取歌词
            b. 是同一首 → 看是否需要校时（暂停变化 / 拖动 / 漂移超阈值 / 到间隔）
            c. 歌词刚取到 → 用当前位置重推一次会话（带 lyricSource）
         4. ad   → 不清空舞台：把当前歌曲重推一次「只有曲目」的会话，但用广告自己的时钟
                   （位置从 0 起、长度用广告的 ~30 秒）——进度条按广告读秒，Folia 的视觉动画
                   把这次重置当成新的无歌词歌曲，约 2 秒后开始播 instrumental 动画；
                   广告结束后按歌曲真实位置带歌词重推；没有会话时什么都不推
         5. idle → 宽限 emptyGraceMs 后清空（切歌瞬间可能读不到）
```

`tick()` 是**唯一的推送出口**：所有 stage 请求都在一次 tick 内串行发生。这样引擎可以被测试用手动时钟逐帧驱动，也不会出现两个并发推送互相覆盖 `sessionUpdatedAt`。

歌词查询的顺序是「首选源 → 网易云 → QQ → 酷狗 → Spotify → LRCLIB」，首选源默认 `spotify`（有登录 token 时），没有 token 时会跳过；本地播放会用 `src/spotify/search.ts` 在 Spotify 搜索里把标题/歌手换成 track id，再取 `color-lyrics`。查询与打分前会用 `src/lyrics/zh.ts` 的 OpenCC 表把繁体转成简体，否则 Spotify 的 `白樺林 / 朴樹` 对不上大陆曲库的 `白桦林 / 朴树`，会被误判成“没有歌词”并缓存 6 小时。

## 4. 会话与时钟

引擎只保留一个 `Session`：

```ts
{
  track,                 // 当前曲目（id + kind 是身份）
  sessionUpdatedAt,      // Folia 给的会话 id；校时请求必须带它
  lyrics,                // 已拿到的歌词（来源 + LRC）
  lyricsOnStage,         // 舞台上的这次会话是否带着歌词（广告期间为 false）
  adHeld,                // 广告期间把舞台留在「只有曲目」的状态，等歌曲回来后接回歌词
  anchorPositionMs,      // 上一次告诉 Folia 的位置
  anchorAtMs,            // 那个位置是什么时候的（Spotify 回答的时刻，不是这一 tick 的开始）
  paused,
  lastClockAtMs,         // 上次校时的时间，用来算间隔
}
```

推算位置：`paused ? anchorPosition : anchorPosition + (now - anchorAtMs)`，并夹在 `[0, duration]`。

判定规则：

| 条件 | 动作 |
| --- | --- |
| `|观测位置 - 推算位置| > seekThresholdMs`（默认 1500） | 视为拖动，立刻 `POST /stage/lyrics/clock` |
| 播放/暂停状态变化 | 立刻校时 |
| 距上次校时 ≥ `clockIntervalMs`（默认 4000）且漂移 > `driftThresholdMs`（默认 900） | 校时一次 |
| 其余情况 | 不发请求（网络和 Folia 都不被打扰） |

广告（`state: 'ad'`）**不清空舞台**：把当前歌曲重推一次不带 `lyricSource` 的会话，但时钟用广告自己的——位置从 0 起、长度用广告的（SMTC / Web API 报的约 30 秒）。这样进度条按广告读秒，Folia 的视觉动画也会把这次时钟重置当成一首新的无歌词歌曲，约 2 秒后开始播 instrumental 动画（不重置的话它要先等 8 秒宽限）。广告结束、同一首歌回来时，按 Spotify 的真实位置带歌词重推；没有会话时什么都不推。清空只留给 idle。

「观测位置」是 `/me/player` 的 `progress_ms` 加上请求往返时间的一半（请求发出到收到响应的中点），见 `src/spotify/player.ts`。这样不用假设本机与 Spotify 的时钟同步；401 触发的刷新时间不计入往返。

## 4.5 用 Folia 的舞台控制条控制播放

Folia 对 Stage API 输入是只读的：按暂停只会调用 `syncStageLyricsClock(..., PAUSED)`（`reference/folia/src/components/app/playback/bridges/usePlaybackTransportController.ts`），下一次 `POST /stage/lyrics/clock` 会把它拉回来。要让舞台的按钮真的控制 Spotify，只能把「舞台状态和我们的推送不一致」当成操作信号：

1. Folia 每秒把舞台播放器快照发布到 `GET /stage/player/status`（`playbackContext: stage-session`，带 `playerState`、`positionMs`、`controlCapabilities`）。
2. 引擎每轮（≤1 秒一次）读它，和**上一次看到的舞台状态**比（不是和我们推送的状态比）：
   - 状态**发生变化**（PLAYING↔PAUSED）→ 如果舞台位置和我们推算的一致（±2.5 秒），当场当作按键发 `play` / `pause`；位置对不上（换歌/重建窗口的过期快照）则等下一轮确认（≥0.4 秒）。如果 Spotify 已经是这个状态（我们自己的推送落地），就只做一次状态推送；
   - 状态**没有变化但一直和 Spotify 相反**（例如卡在暂停）→ 不当作按键，持续 2.5 秒后反过来把 Spotify 的状态推给舞台（这就是「Spotify 暂停后 Folia 不跟随」的修复）；
   - 状态一致、位置差 > 2.5 秒 → 发 `seek`（`TryChangePlaybackPositionAsync`，单位是 100ns tick）。
3. 发完命令后把 `session.paused` 立刻改成意图状态（客户端要几百毫秒才生效），并静默 1.5 秒；同一个意图 3 秒内不重发。之后的 5 秒里，Spotify 报告的旧状态**不算“播放状态变了”**，否则下一次时钟推送会把刚按下的暂停顶回去。
4. **每次时钟推送都带 `paused`**（取我们告诉 Folia 的状态）。省略它时 Folia 会沿用上一次会话推送里的 paused，那个值比舞台上的按键旧，按钮就会自己变回去；这是「按了暂停一会儿又变回播放」的根因。
5. 漂移校正不再是每 2 秒一次：Folia 自己按时间外推，只有差超过 5 秒才补；要补之前还会再读一次舞台状态，若它和我们对不上（有按键还没处理）就跳过这一轮。
6. 控制脚本（`controlSession.ps1`）自己 4 秒超时，主进程串行排队执行；`--no-control` / `SPOLYRIC_CONTROL=off` 可以整套关掉。

避免误判的三条：

- 周期性的漂移校正**不再携带 `paused`**（Folia 不传就沿用上一次），所以不会把用户按下的暂停顶回去；只有 Spotify 自己的播放状态变化时才带 `paused`。
- 我们自己每次推送后 1.5 秒内不读舞台状态，避免回声。
- 快照超过 4 秒未更新就忽略（Folia 卡住/窗口隐藏时不会乱发命令）。

限制：只有 `local` 模式（SMTC）能控制；Folia 在 stage-session 下把 `previous` / `next` 能力关掉了，所以只有播放/暂停/拖动；延迟 1–2 秒。

## 5. 模块与依赖方向
```
src/main.ts
  └─ cli/commands.ts ── cli/args.ts
       ├─ sync/runner.ts ── sync/engine.ts
       │    ├─ sync/playerSource.ts     （Web API / SMTC / auto 选择）
       │    ├─ spotify/player.ts        （Web API 只读播放状态）
       │    ├─ media/session.ts         （启动 readSession.ps1 并解析它的输出行）
       │    ├─ media/player.ts          （SMTC 采样 → 平滑后的播放状态）
       │    ├─ spotify/lyrics.ts        （歌词来源顺序 + 磁盘缓存）
       │    └─ folia/stage.ts           （Stage API 客户端）
       ├─ spotify/auth.ts               （PKCE 登录 / 刷新 / token 存储）
       ├─ folia/connection.ts           （读 stage/connection.json）
       ├─ proxy.ts、config.ts、paths.ts、log.ts、http.ts
       └─ version.ts
```

规则：

- **只有 `folia/stage.ts`、`spotify/*`、`media/*` 说协议**；`sync/` 只做决定，不拼 HTTP、不起进程。
- **`engine.ts` 不 import `runner.ts`**：引擎不关心循环、重连、信号；runner 不关心阈值与歌词。
- **时间从外面注入**（`now`），测试才能用手动时钟驱动；`media/session.ts` 的 `spawn` 也能注入，测试不需要真的 PowerShell。
- 没有第三方运行时依赖：HTTP 用 Node 内置 `fetch`，代理用 `http`/`https`/`tls`，测试用 `node:test`。

## 6. 错误分类与恢复

| 来源 | 错误 | 谁处理 | 怎么处理 |
| --- | --- | --- | --- |
| Spotify | `401` | `player.ts` | 让 token provider 强制刷新，重试一次；还失败就抛给引擎记日志。强制刷新 15 秒内只做一次，避免 401 变成每轮都换 token |
| Spotify | 网络错误 / 超时 | `engine.tick` | 记一条 warn（30 秒内只记一次），这一 tick 什么也不改 |
| Spotify | `invalid_grant`（授权被撤/过期） | `engine` 重抛 → `runner` | 停止进程并提示 `spolyric login`，不无限重试 |
| Spotify | 令牌接口 5xx / 429 / 408 / 无错误体的拒绝 | `auth.tokenRequest` | 当作可重试错误（不是登录失效）；引擎记日志后下一轮再试 |
| Spotify | `403` | `player.ts` / `playerSource.ts` | 先退到 `/v1/me/player/currently-playing`；`auto` 模式再退到本机 SMTC，并把 Spotify 的原话记进日志 |
| Spotify | `Active premium subscription required for the owner of the app` | `auto` | 这是免费账号建应用的必然结果：永久切到 SMTC，不再重试 Web API |
| Spotify | token 没有播放状态的 scope | `auth.ensure` | 抛 `scope-missing`，让人 `logout` 后重新登录；登录时每次都请求授权页，避免旧授权没带新 scope |
| Spotify | `429`（播放状态接口） | 无特殊处理 | 日志会看到；用户调大 `--poll` 或换 Client ID |
| SMTC | 脚本退出 / 启动失败 | `media/session.ts` | 记 warn，5 秒后重启；期间当作「没有在播放」，不挡主循环 |
| SMTC | 别的播放器占着会话 | `media/player.ts` | 只认 `app` 里带 `Spotify` 的会话，其余当作 idle |
| Folia | 连不上 / 401（Folia 重启换了 token） | `runner` | 每轮重读连接文件；地址或 token 变了就重建客户端与引擎；健康探测失败时暂停推送，等它回来 |
| Folia | `STAGE_LYRICS_SESSION_CHANGED` / `..._INACTIVE` / `..._UNCLOCKED` | `engine.pushClock` | 先用 `GET /stage/status` 看一眼：舞台还是这个会话就把整段重推一次；已经被别的来源接手就放手一分钟，不抢 |
| Folia | 清空舞台失败 | `engine.clearIfOurs` | 保留会话，下一 tick 重试；不会把「没关掉」当成「已关掉」 |
| Folia | 歌词重推失败 | `engine.attachLyrics` | 结果留在 `pendingLyrics` 里，下一 tick 重试，不会丢歌词 |
| 歌词 | Spotify 404 / 任意来源 404（没这首） | `lyrics.ts` | 正常降级到下一个来源；所有能问的来源都说没有才缓存「没有」（6 小时） |
| 歌词 | 网络错误 / 5xx / 429 | `lyrics.ts` | 记 debug、降级，**不缓存**「没有」，下次再试 |
| 网络 | 需要代理才能访问 | `proxy.ts` + `http.ts` | 自动找 `SPOLYRIC_PROXY` / 环境变量 / Windows 系统代理；通过 CONNECT 隧道发请求 |
| 舞台控制 | 用户在舞台按了播放/暂停/拖动 | `engine.reconcileTransport` | 用 SMTC 命令作用到本机 Spotify；失败记一行，不重试风暴；`web` 模式不控制 |

## 7. 配置与路径

| 数据 | 位置（Windows） |
| --- | --- |
| 设置 | `%APPDATA%\Spolyric\config.json` |
| Spotify token | `%APPDATA%\Spolyric\spotify-token.json`（POSIX 上 0600） |
| 歌词缓存 | `%APPDATA%\Spolyric\lyrics-cache\<sha1>.json` |
| Folia 连接文件 | `%APPDATA%\Folia\stage\connection.json`（只读） |

- `SPOLYRIC_HOME` 改数据目录（便携安装、测试）。
- `SPOLYRIC_FOLIA_DATA` 指定 Folia 数据目录（便携版 Folia、多份安装）。
- 平台差异集中在 `src/paths.ts`：Linux 先找 `$XDG_RUNTIME_DIR/folia/stage.json`，再找配置目录；macOS 用 `Application Support`；Windows 还会扫描 `%APPDATA%` 下以 `folia` 开头的目录（dev 构建叫 `folia-major`）。
- 设置读取顺序：默认值 → `config.json` → 环境变量 → 命令行。`config.json` 只在 `login` 时写入（Client ID / 端口），其余选项用命令行或环境变量即可。

## 8. 安全

- Spotify：PKCE + 回环重定向，无 client secret；只申请 `user-read-playback-state`、`user-read-currently-playing`；token 只存本机，日志不打印，POSIX 上 0600（Windows 靠用户目录 ACL）；刷新采用单飞（并发请求只刷新一次），强制刷新有 15 秒节流。
- Folia Stage token：从连接文件读，只在 `Authorization` 头里用，不落盘、不打印；`status`/`config` 输出里也不显示。
- 登录用的 `127.0.0.1:<port>` 只在登录那一次监听，拿到 code 立刻关闭；state 不匹配直接拒绝。
- 不监听任何常驻端口；所有请求都是出站，且都会随 `Ctrl+C` 一起中止。
- local 模式：起一个 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File readSession.ps1` 子进程，只读 SMTC，不写任何文件、不联网；退出/`Ctrl+C` 时杀掉它。
- 代理：`SPOLYRIC_PROXY` / `HTTPS_PROXY` / Windows 系统代理；**不读取代理的凭据日志**，CONNECT 的 `Proxy-Authorization` 只放在内存里。

## 9. 测试策略

- `node:test`，编译后跑 `dist/test/*.test.js`（`npm test`，173 个用例）。
- 假件在 `test/helpers/fakes.ts`：假 Stage（记录会话/时钟/清空、可注入 409 与标题）、假播放器（可变快照）、假歌词（可 gate 住，模拟「歌词后到」）、手动时钟。
- 纯函数单测：PKCE、LRC 生成/校验、条目归一化、配置夹取、路径发现、连接文件解析（含 JSON `null` / 数组）、代理解析、SMTC 输出行解析。
- 协议单测：`src/folia/stage.ts`、`src/spotify/player.ts`、`src/http.ts` 跑在真的 loopback HTTP 服务上（`test/helpers/server.ts`），检查方法、Authorization、请求体、错误码、标题解析、403 回退、错误正文里的 Spotify 原话。
- 代理单测：起一个真的 CONNECT 代理 + 目标 HTTP 服务，验证请求确实走隧道、错误照样变成 `HttpError`、代理拒绝隧道时有明确错误。
- 播放来源单测：`local` 不需要网络、非 Windows 报错、`web` 不预检、`auto` 懒切换（第一次读取前不发请求，403 后切到本机）。
- 本地播放器单测：SMTC 采样映射、按墙钟推进、只在采样变化时修正、拖动跳变、暂停保持、切歌重置、非 Spotify 会话忽略。
- 控制单测：舞台暂停/播放/拖动转成 SMTC 命令、自己的推送不回声、状态已追上时不误判为拖动、快速连按发送 play 而不是 seek、重复意图去重、快照过期忽略、dry-run 不发命令；`parseControlAnswer` 的成败解析。
- 歌词解析单测：Spotify 优先、404 降级、缓存命中、网络错误不缓存、一个来源说「没有」另一个失败时不缓存、禁用来源时不请求。
- 引擎单测：用 `tick()` 逐帧驱动，覆盖 §4 的每条规则和 §6 的恢复路径（含「清空失败要重试」「歌词重推失败不丢」「别的来源占了舞台就放手，且下一 tick 不再抢」）。
- 登录单测：授权 URL、token 存储与权限、单飞刷新、`invalid_grant` 清登录、503 可重试、端口占用、超时提示。
- 端到端：`test/runner.test.ts` 起「假 Spotify + 假 Folia」，写真的连接文件与 token 文件，跑 `runSync`，断言 Folia 收到带 token 的推送；另有「没有连接文件时等待」「连接文件指向已经关掉的 Folia 时不死循环」「`--once` 一步就退出」「`--dry-run` 没有 Folia 也能跑」。
- 手动脚本：`scripts/demo.mjs` 用假 Spotify + 假歌词库，让真实 Folia 舞台跑起来做联调；`src/media/readSession.ps1` 在本机对着真实的 Spotify 桌面端跑过（曲目、时长、进度、播放状态都正确）。

### 编码这件事（踩过的坑）

Windows PowerShell 5.1 读 `.ps1` 时，没有 BOM 就按 **ANSI（中文系统是 GBK）** 解释，而且写 stdout 时默认用控制台代码页。这带来两个连锁问题：

1. 脚本里的中文注释被按 GBK 解码，某个字符的字节会吃掉行尾换行，下一行代码被并进注释（`$utf8NoBom` 变成 `$null`，`[Console]::OutputEncoding` 赋值失败）。
2. 中文歌名以 GBK 字节输出，Node 按 UTF-8 读会得到 U+FFFD 替换字符，Folia 显示乱码；LRCLIB 用乱码歌名搜不到，就没有歌词。

现在的做法：**脚本只用 ASCII**（英文注释），并在任何输出之前把 `[Console]::OutputEncoding` 设成 UTF-8；Node 侧按字节切行、严格 UTF-8 解码，失败再按 GBK 解码兜底（`decodeSessionLine`）。测试覆盖了 GBK 字节的兜底。

## 10. 已知缺口与后续

1. **逐字歌词**：Spotify 的 `SYLLABLE_SYNCED` 可以转 enhanced LRC（`<mm:ss.xx>`），Folia 舞台也接受 `formatHint: 'enhanced-lrc'`。但 Spotify 的逐字数据并非每首都有、边界也不稳定，先把逐行做准。要做的话在 `src/spotify/lyrics.ts` 增加一个按行组装的函数，并在配置里加开关。
2. **local 模式的封面**：先试 **Spotify 自己的缩略图**——`src/media/coverSession.cs` 编译成的 `cover.exe` 通过 SMTC 读取 `MediaProperties.Thumbnail` 并写一个临时文件（PowerShell 5.1 的 WinRT 投影拿不到这个流，所以用了这个 6 KB 的 .NET 辅助程序；源码在仓库里）。`cover.exe` 失败或没有缩略图时，再让 `src/cover/resolver.ts` 按标题 + 歌手 + 时长并行查 iTunes、QQ 音乐（专辑 mid）、酷狗（`Image`）与 Deezer，取第一个匹配（标题必须一致，歌手或时长至少一项对得上）。之后缓存到 `%APPDATA%\Spolyric\covers\`，由 `src/cover/server.ts` 的 loopback 服务以 `http://127.0.0.1:<port>/cover/<key>.jpg` 提供给 Folia（Stage API 拒绝 data URL，只收 http(s)）。
3. **免费账号的本机播放控制**：播放/暂停/拖动已经接通（§4.5，SMTC）。上一首/下一首在 Folia 的 stage-session 上下文里被关掉了（`controlCapabilities.previous/next = false`），已用 `spolyric key next|prev` 和模组的全局快捷键（`Ctrl+Alt+←/→`）绕过。控制脚本是常驻的：第一条命令约 0.4 秒，之后几毫秒；实测舞台暂停到 Spotify 暂停约 2 秒（大头是 Folia 每秒发布一次舞台状态和 Spotify 自己的 SMTC 更新）。
4. **Now Playing WebSocket 后端**：如果希望 Folia 设置里直接选「Now Playing」而不是「Stage API」，可以实现它的 `ws://localhost:9863/api/ws/lyric` 服务端（协议见 `reference/folia/src/services/nowPlayingProvider.ts`）。代价是自己写 WebSocket 帧处理，收益只是少两个开关。
5. **多份 Folia**：连接文件里带 `pid`，目前只用第一个找到的；多份安装时用 `--connection` 指定。
6. **上游脆弱点**：Spotify 的 `color-lyrics` 是未公开接口（要 `app-platform: WebPlayer` 头，否则 400）；Web API 的 `/me/player` 是公开且有文档的，但应用 owner 必须有 Premium；SMTC 的 WinRT 投影随时可能随 Windows 更新变动；网易云/QQ/酷狗/LRCLIB 的公开接口也可能改。这些失败都会降级，不会让主流程崩。

## 11. 作为 Folia 模组分发

`scripts/assemble-mod.mjs`（`npm run mod`）把编译产物装配成 `dist-mod/spolyric/`：

```
spolyric/
  mod.json      folium: 2, main: main.cjs, permissions: []
  main.cjs      Folia 主进程里的入口（Node，可 require 任意模块）
  runtime/      dist/src 的副本 + package.json { "type": "module" }
  README.md
```

`main.cjs` 在 `activate(api)` 里：

1. 检查 `runtime/src/main.js` 存在；
2. 用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` spawn 子进程（Folia 的 exe 本身就是 Electron/Node），参数默认 `run`，可用 `SPOLYRIC_MOD_ARGS` 覆盖；如果用户的 Folia 不肯以 Node 方式运行，可用 `SPOLYRIC_NODE` 指到一个 `node.exe`；
3. 把 stdout/stderr 按行转给 `api.log`；
4. `api.onDispose` 和 `process 'exit'` 时 `child.kill()`。

单实例：`acquireRunLock(dataDir)` 在 `runCommand` 里写 `%APPDATA%\Spolyric\run.lock`（PID + 时间），进程不在了就接管，活着就返回 null（这次不启动）。这样「Folia 模组拉起的」和「终端手动跑的」不会同时往舞台推。

模组面板里能看到日志；禁用模组即停止。Folia 的签名只是标识，未签名的社区模组启用时会确认一次，功能不受影响。
