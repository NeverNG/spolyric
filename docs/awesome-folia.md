# Awesome-Folia 登记

Spolyric 会启动独立的 Node 运行时，按 Folia 的规则属于**外部程序 / App**：不进入 `folium-compound` 的签名仓库，而是在 **Awesome-Folia** 以外部链接登记。市场里显示为「外部链接」，用户从本仓库 Releases 安装，问题也回到本仓库。

表单：<https://github.com/chthollyphile/folium-compound/issues/new?template=awesome-entry.yml>

> 用表单提交，GitHub 会自动带上 `awesome-entry` 标签并触发检查机器人；用 API 直接创建的 issue 拿不到这个标签，机器人不会运行。

## 填写内容

- **登记 id**：`spolyric`
- **名称**：`Spolyric — 免费 Spotify 跟随`
- **类型**：`外部程序 / App (app)`
- **链接**：`https://github.com/NeverNG/spolyric`
- **简介**：

  > Spolyric 读取 Windows 上 Spotify 桌面端正在播放的歌（SMTC），把歌名、歌手、封面、进度和歌词送进 Folia 舞台。免费 Spotify 账号可用，不需要会员，也不需要在模组里登录 Spotify；它不播放音频，声音仍由 Spotify 桌面端播放。需要先打开 Folia 的「舞台模式」并把来源选为 Stage API。模组会启动独立的 Node 运行时并通过 Stage API 推送，数据和缓存在 `%APPDATA%\Spolyric`；从 GitHub Releases 安装。

- **作者**：`NeverNG`
- **分类**：`系统集成 / System integration (system)`
- **许可证**：`MIT`
- **确认**：三项都勾选

## 登记后

维护者评论 `/list <校验码>` 后条目生效；原来的签名仓库提交 issue（#203）就可以关闭。
