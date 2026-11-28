# release/spolyric

这个目录是 `npm run mod` 生成的成品，直接用于 Folia 模组安装和 **Awesome-Folia 外部作品登记**：Spolyric 会启动独立运行时，按 Folia 的规则属于「外部程序」，不进入签名仓库，用户从 GitHub Releases 安装，问题回到本仓库。

不要手改里面的文件，改仓库里的源码后重新生成。

- `mod.json`、`main.cjs`、`client.mjs`、`README.md`、`preview.jpg`
- `runtime/`：编译后的 Spolyric 本体（`dist/src` + 两个 PowerShell 脚本，不含 source map）
