# 光遇风格「音乐小球 + 歌词」Folia 模组 · 可行性评估

> **范围更新（2026-11-26）**：模组已按「Folia 自带音源 + 独立模组」实现，不涉及 Stage API / Spolyric，代码在 `lumen-keys/`。第 4.1 节关于 Stage API 没有真实音频的限制**不再适用于本模组**——音频反应直接走 Folia 自己的 analyser。下面保留原始评估作为记录。

- 评估对象：Folia 0.8.2（本机安装版），Folium 模组接口 1.10
- 评估方式：读 Folia / Folium 源码、Stage API 文档、两个官方示例模组（`sample-aurora-visualizer`、`visualizer52hz`）；**尚未在 0.8.2 上实跑**
- 参考快照：`reference/folia`（0.8.0 源码，接口只增不减，0.8.2 只会更多）

---

## 一、结论

**能做，而且不需要改 Folia 本体。** 用 Folium 1 的 `visualizers`（歌词动画模式）注册一个全屏 WebGL 样式即可：全屏画布、逐字时间、每帧回调、设置面板、预览 / 透明导出都有现成接口。Folia 自己也用 three.js 做了三个歌词样式（`diorama`、`machi`、`metaphor`），所以「3D + Bloom」在这套渲染器里是已经验证过的路径。

但「像截图」和「跟音乐」是两件事，必须先分开：

| 目标 | 可行性 | 说明 |
| --- | --- | --- |
| 画面像截图：透视琴键、泡泡、逐字漂浮、辉光 | **高（85–90%）** | three.js + 后处理；差异主要在真实折射、体积光这类高成本效果 |
| 歌词逐字点亮 | **高** | 有逐字歌词时约 ±50 ms；只有整行 LRC 时按字均分，长句会显假 |
| 小球跟着音乐跳 | **低（Stage API 模式）** | 这条链路没有真实音频分析，只有一条与音乐无关的「呼吸」信号 |
| 小球跟着旋律 / 音高落到对应键 | **低** | 需要乐谱 / MIDI；FFT 给不出可靠音高 |

一句话：**作为「歌词驱动的 3D 演出」完全可行；作为「音频可视化」在 Stage API 模式下不可行**（Folia 自己播放音频时可行）。

---

## 二、截图拆解

| 画面元素 | 实现手段 | 难度 |
| --- | --- | --- |
| 蓝紫渐变、柔光、颗粒、暗角 | 全屏 fragment shader（渐变 + 噪声 + 暗角），后处理加颗粒 | 低 |
| 倾斜的琴键阵列（近大远小、每键一根细杆） | three.js `InstancedMesh`：圆角盒 + 细圆柱；透视相机 + 雾 | 中 |
| 半透明玻璃板、顶部光带 | 半透明平面 + 加法混合 + Bloom | 低 |
| 虹彩泡泡 / 音乐小球 | 球体 + 菲涅尔 + 伪环境色（不做真折射），边缘彩虹 | 中 |
| 上升光点、命中爆闪 | GPU `Points` + 自定义 shader，按事件发射 | 低 |
| 歌词逐字漂浮 | Canvas 画字 → 贴图 → 3D 平面；逐字 reveal + 位移 + 发光 | 中 |
| 击键反馈（键下沉、涟漪、闪光） | 命中事件驱动：per-instance 位移 + 环形 shader + 粒子 burst | 中 |
| 缓慢运镜 / 呼吸 | 相机路径 + 噪声；暂停即冻结 | 低 |
| 景深 | 简化成雾 + 远景降透明；真 DOF 要深度 pass，成本高 | 中 / 高 |

截图里那个大播放按钮是视频播放器的控件，不属于要复刻的画面。Folia 自己的播放器控件会盖在场景上。

---

## 三、Folia 侧能力核对

| 需要 | 接口 / 事实 | 证据 |
| --- | --- | --- |
| 全屏自定义渲染 | `registries.visualizers.register({ mount })`，容器 `absolute inset-0`、在 ShadowRoot 里；**无需权限**，导出窗口也生效 | `docs/folium/api.md:199`、`src/mods/folium/registries/visualizerRender.tsx:127` |
| 每帧循环 | `ctx.onFrame(ts)`、`ctx.onLyricTime(sec)`、`ctx.onResize`、`ctx.every`，与宿主共用帧循环，暂停 / 后台自动停 | `docs/folium/api.md:706-711` |
| 3D / WebGL | 宿主内建 three.js 样式；`machi` 用 `UnrealBloomPass` | `src/components/visualizer/diorama/DioramaScene.tsx`、`src/components/visualizer/machi/engine/fx/bloomPass.ts:3` |
| 逐字时间 | `FoliumLine.words[{ text, startTime, endTime }]` | `docs/folium/api.md` FoliumLine |
| 音频 | `ctx.audio.getPower()` / `getBands()` / `getSpectrum()`，0–1 | `src/mods/folium/audio.ts` |
| 设置 | schema（number / color / select / boolean），宿主持久化，随视觉配置导入导出 | `mods/README.md:290` |
| 打包 | zip ≤ 96 MB、解压后 ≤ 96 MB、单文件 ≤ 64 MB、条目 ≤ 2000 | `electron/modSystem/zipInstall.cjs:32-35` |
| 第三方库 | 可以把库放进模组目录，用相对路径 import；52Hz 自带约 800 KB 的 PIXI | `mods/visualizer52hz/vendor/pixi.min.mjs` |
| 版本声明 | `folium: 1` 对应 Folium 1.10；清单可写 `folia` 范围 | `electron/modSystem/foliumShared.json:2-3`、`manifest.cjs:587` |

结论：**渲染、时间轴、设置、打包四件事都是现成的**，不需要 `internals`（无兼容承诺的内部接口）。

---

## 四、必须先接受的 5 个限制

### 4.1 Stage API 模式没有真实音频（最关键）

`usePlaybackVisualizerBridge.ts:249` 把「外部 Stage 播放」排除在真实音频之外：

```ts
const isActuallyPlaying = !isHifiActive && !isExternalActive && Boolean(audioElement && ...);
```

没有真实信号时，宿主写入的是一条正弦「呼吸」：`(sin(t)+1)*20`，归一化后约 **0–0.157**，频谱是空数组（`同文件 291-301`）。也就是说：

- `ctx.audio` 在 Stage API 模式下**与正在放的歌无关**；
- 基于频谱的节拍检测（52Hz 的 `beatDetector.mjs`）在这条链路上等于没有输入；
- 内建的音频反应类样式在 Stage API 模式下同样会「变平」。

三条路：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A（推荐） | 用歌词时间轴编排小球：每个字 / 词一个音，落在键上 | 零依赖，同步精度取决于歌词 |
| B | Spolyric 升级成逐字歌词（QRC / YRC / 增强 LRC） | 见 4.2，效果最好 |
| C | 真实频谱 | 只有 Folia 自己播放音频时才有；Stage API 模式拿不到 |

想要「音符级对位」（哪个字对应哪个音高 / 哪个键），必须有乐谱或 MIDI；FFT 只能给能量，给不了可靠音高。

### 4.2 逐字歌词要上游配合

- Stage API 接受 `formatHint: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | 'qrc'`（`test/manual/stage-client/API_SCHEMA.md:124`），Folia 解析后就是带 `words` 的行；
- 但 Spolyric 现在只发整行 LRC：`src/sync/engine.ts:176` 固定 `formatHint: 'lrc'`，QQ / 网易 / 酷狗的模块都把结果 `normalizeLrc` 成整行；
- 所以「一个字一个字精确点亮」要么等 Spolyric 改（QQ 取 QRC、网易取 YRC，或转增强 LRC），要么在模组里按行时长均分（`sample-aurora-visualizer/client.mjs` 就是这么做的）。

这一条不影响「能不能做」，只决定「歌词跟得准不准」。

### 4.3 字体和素材只能内嵌

`folia-mod://` 对 `folium: 1` 模组只发 `.js` / `.mjs`（`electron/modSystem/modProtocol.cjs:143-154`）；`folium: 2` 多了 `.svg/.png/.webp/.json`，仍然没有 `.woff2`。所以：

- 字体用 base64 内嵌 + `FontFace` API，或退回系统字体栈（`theme.resolveFontStack`）；
- 中文全量字体 5–15 MB（TTF/OTF 原始体积），base64 再加 33%；建议只嵌常用字子集（构建时生成），其余走系统回退；
- 贴图不要外置，全部用 Canvas 程序化生成（噪点、光斑、键面渐变）。

### 4.4 模组只在主窗口加载

`bootstrap.tsx:121` 的 `if (!isMainApp) return;` 决定了：

- **OBS 浏览器源不加载模组**，直播请用窗口捕获 / 透明导出；
- 透明导出窗口可以（`visualizers` 在那个窗口里生效，`docs/folium/api.md:199`）；
- 桌面歌词窗口、遥控窗口不会出现这个样式。

### 4.5 性能与分辨率

- 宿主会给每个模组记「每秒用多少毫秒」，满 240 ms 标「慢」（`mods/README.md:1847-1849`）；
- 4K + Bloom + 逐字贴图是主要开销；内建 three.js 样式证明可行，但模组和宿主共用帧循环；
- 必须做质量档：DPR 上限、半分辨率 Bloom、粒子数量、远景精度；静止预览 / 设置预览降级。

### 4.6 IP 与命名

「光遇 / Sky: Children of the Light」是 thatgamecompany 的商标与美术。风格致敬可以，**不要用它的素材、图标、名称做公开上架名**；个人自用风险低，上架 Folia 模组市场要另说。

---

## 五、推荐方案

### 5.1 形态

独立的 `visualizers` 模组（不是 Spolyric 的一部分）：

- 不依赖 Spolyric；Folia 自己播放时也能用；
- 只注册一个歌词动画模式 + 一组设置 + 一个切换到它的命令；
- 不需要任何权限（`visualizers` 无需权限，`stageLayers` 才需要，而本方案用不到）。

### 5.2 模块划分

```
skyball/
  mod.json              folium: 1, client, preview
  client.mjs            注册 visualizer、settings、切换命令
  src/
    mount.mjs           容器、canvas、生命周期、ctx 绑定
    scene.mjs           背景、琴键阵列、细杆、泡泡、粒子
    lyrics.mjs          字形贴图、3D 排版、逐字时间轴
    choreography.mjs    小球发射 / 命中 / 键位反馈
    post.mjs            渲染目标、Bloom、色调、颗粒
    quality.mjs         质量档（尺寸 / DPR / 全局渲染质量）
    settings.mjs        设置 schema
  vendor/
    three.module.min.js   three 的 ESM 构建（新版本会再带一个 three.core.min.js），没有裸 import
```

不需要打包器：three 的 ESM 构建（按版本是 1–2 个文件，新版带 `three.core.min.js`）自身没有裸说明符，用相对路径 import 即可；后处理自己写 render target，不引 `examples/jsm`（那里面的 `import 'three'` 是裸说明符，模组解析不了）。

### 5.3 渲染管线

1. 背景 pass：渐变 + 噪声 + 柔光；
2. 场景 pass：`InstancedMesh` 琴键 + 细杆 + 泡泡 + 粒子 + 字形平面；
3. 后处理：半分辨率 Bloom → 色调映射 / 暗角 / 颗粒 → 轻微色差；
4. 字幕：翻译 / 下一句交给宿主画（`hostLayers.subtitles: true`），主句自己画；不透明场景设 `hostLayers.background: false`。

### 5.4 数据流

```
ctx.lyricTime ──> 行索引 ──> 当前行 words ──> 逐字 reveal
                                   │
                                   └──> 命中时间 ──> 小球发射 ──> 键位反馈
（可选）ctx.audio ──> 能量 ──> 环境呼吸 / 粒子密度（仅 Folia 自己播放时有效）
```

### 5.5 关键实现点

1. **时钟只用 `ctx.lyricTime.get()`**，不要用 `performance.now()`；否则暂停、拖动、导出都会偏。
2. 换歌由宿主重挂载；在 `mount` 里建场景，dispose 里释放几何体 / 纹理 / 渲染目标。
3. seek 检测：歌词时钟跳变超过 0.5 s 就重置小球状态（52Hz 的做法），避免拖进度后小球停在半空。
4. `staticMode` 只画一帧；`isPreview` 下降质量、不自动跑粒子。
5. 命中时间取 `words[i].startTime`；没有 `words` 时按行时长均分，并在设置里给「提前 / 延后」滑杆。
6. 键位由 `hash(char, index, seed)` 决定，保证预览 / 播放 / 导出画面一致；同一句内避免连续落在同一个键。
7. 字形缓存按 `(字符, 字体, 字号, 颜色)` 做 LRU，设上限（例如 256 张），换歌清理。
8. 质量档：`folium.visualizer.getRenderQuality()`（1.8+）+ 窗口尺寸 + `devicePixelRatio` 上限 1.5。
9. 竖屏 / 横屏两套构图：截图是 9:16，桌面横屏时键阵列收在下方 2/3，歌词放中央安全区；`onResize` 重排而不是整体缩放。
10. 无歌词 / 纯音乐：退化成环境粒子 + 空键阵列，不崩、不空屏。

---

## 六、分期与工作量

| 阶段 | 内容 | 人日 | 产出 |
| --- | --- | --- | --- |
| 0 验证 | 空模组 + 全屏 WebGL + 字形贴图 + 字体 + 导出，在 0.8.2 上跑通 | 3–5 | 骨架 + 实测帧率 + 一帧对比图 |
| 1 场景 | 背景、琴键阵列、透视 / 雾、Bloom、相机 | 5–8 | 静态画面接近截图 |
| 2 歌词 | 逐字时间轴、3D 排版、reveal、翻译字幕兼容 | 4–6 | 跟唱效果 |
| 3 小球 | 小球 / 泡泡、贝塞尔飞行、命中反馈、粒子 | 4–6 | 演出闭环 |
| 4 收尾 | 设置面板、质量档、暂停 / seek / 换歌、导出、低端机 | 4–6 | 可发布 v1 |

合计 **20–31 人日**（1 人）。如果只做 2.5D（PIXI，不引 three.js），可压到 **10–15 人日**，代价是景深和透视质感弱一档。

开发流程上的一个摩擦：装在 `%APPDATA%\Folia\mods` 的模组**改文件会撤销确认**，每次要重新启用；源码树里的 `mods/` 只有开发版构建才免确认。所以阶段 0 会同时做一个 `preview.html`，同一份场景代码在浏览器里直接调，只有集成问题才进 Folia。

---

## 七、验收标准

- 1080p 稳定 60 fps；4K 中档质量 ≥ 45 fps（中端独显）；
- 暂停 / 继续 / 拖动进度 / 切歌后 200 ms 内画面正确，没有悬空小球或残留文字；
- 静态预览帧与该时刻播放帧一致（同一个 `seed`）；
- 导出窗口画面与播放页一致；
- 连续播放 30 分钟内存平稳（字形纹理缓存有上限）；
- 没有歌词、纯音乐、音源被切走三种情况都不崩。

---

## 八、风险表

| 风险 | 概率 | 影响 | 对策 |
| --- | --- | --- | --- |
| Stage API 模式没有真实音频 | 确定 | 中 | 歌词驱动编排；可选逐字歌词升级 |
| 逐字歌词缺失 | 高 | 中 | 均分回退 + 设置里可调提前 / 延后 |
| 中文字体体积 | 中 | 中 | 子集化 + 系统字体回退 |
| 4K / 低端 GPU 掉帧 | 中 | 高 | 质量档、半分辨率 Bloom、粒子上限 |
| 模组市场签名 | 低 | 低 | 自用无需签名；上架需官方认证 |
| Folia 版本差异 | 低 | 中 | 阶段 0 在 0.8.2 实机验证；清单写 `folia` 范围 |
| IP / 命名 | 中 | 中 | 原创名称与美术，不搬 TGC 素材 |

---

## 九、需要你定的 4 件事

1. **使用场景**：只在 Folia 播放页实时看，还是也要透明导出 / 竖屏剪视频？（影响构图和确定性要求）
2. **同步目标**：接受「歌词驱动」吗？要不要同时改 Spolyric 推逐字歌词（QRC / YRC）？
3. **视觉档位**：全 3D（20–31 人日）还是 2.5D 轻量版（10–15 人日）？
4. **发布方式**：个人自用，还是上架 Folia 模组市场？（涉及签名、命名、字体授权）

确认后我先做阶段 0（3–5 天）：一个能装进 0.8.2 的空壳模组 + 全屏 WebGL + 一帧静态画面 + 实测帧率。这一步就能把「能不能做」变成「看起来像不像」。

---

## 附：证据索引

| 结论 | 文件 |
| --- | --- |
| visualizers 无需权限、导出窗口生效 | `reference/folia/docs/folium/api.md:199` |
| 模组容器 `absolute inset-0`，宿主背景 / 字幕可关 | `reference/folia/src/mods/folium/registries/visualizerRender.tsx:119-147` |
| 逐字时间与歌词上下文 | `reference/folia/docs/folium/api.md:674-713` |
| Stage API 歌词格式（含 qrc / yrc） | `reference/folia/test/manual/stage-client/API_SCHEMA.md:124` |
| Stage API 模式下音频是「呼吸」 | `reference/folia/src/components/app/playback/bridges/usePlaybackVisualizerBridge.ts:247-301` |
| Spolyric 只推整行 LRC | `src/sync/engine.ts:176` |
| 模组协议只发 js / mjs | `reference/folia/electron/modSystem/modProtocol.cjs:143-154` |
| 模组只在主窗口启动 | `reference/folia/src/bootstrap.tsx:120-125` |
| 打包体积上限 | `reference/folia/electron/modSystem/zipInstall.cjs:32-35` |
| 宿主内建 three.js 与 Bloom | `reference/folia/src/components/visualizer/machi/engine/fx/bloomPass.ts:1-10` |
| 模组自带第三方库的先例 | `reference/folia/mods/visualizer52hz/client.mjs`、`vendor/pixi.min.mjs` |
| 52Hz 的 seek / 暂停 / 静态预览处理 | `reference/folia/mods/visualizer52hz/stage.mjs` |
