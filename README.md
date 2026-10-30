# dsh-mnemosyne

DeepSeek Harness 插件：一键把 **Mnemosyne OS 记忆系统（v8.1.0, 52 工具）** 接入本机，并让**所有 Agent、所有会话框全局生效**。

## 它做了什么

1. **授权**：`dsh-mnemosyne-login` 用设备授权流程（device flow），浏览器里登录一次即拿到你专属的 `mn-` 密钥——密钥只存在本机 profile，绝不进仓库、不进安装包。
2. **注册 MCP**：把 `mcp-mnemosyne` 条目写入 `~/.dsh/profiles/<profile>/cordis.patch.yml`，指向 `https://ai-memory.net/v1/mcp`（Streamable HTTP，按 key 隔离）。
3. **注入全局规则**：把记忆规则区块追加进 `~/.dsh/AGENTS.md`（DSH 用户全局槽，每轮自动注入）——这就是「所有 Agent / 所有会话框自动应用」的关键。
4. 重启 `dsh web` 生效。

## 安装

```bash
dsh plugin add dsh-mnemosyne
# 或经 SkillHub 市场安装
```

## 首次授权

```bash
dsh-mnemosyne-login          # 默认 profile=web
```

按提示在浏览器打开链接、点「授权」，命令会自动完成 MCP 注册 + 规则注入。

## 卸载

```bash
dsh-mnemosyne-login --remove # 清掉 MCP 条目与规则区块
```

## 与 mnemosyne-memory 技能的关系

- **`mnemosyne-memory`（SkillHub 技能）**：携带完整的 52 工具记忆系统说明，作为模型指令；并在安装时附带 `install.mjs` 做同样的规则注入 / MCP 注册（无需登录器也能手动配 key）。
- **`dsh-mnemosyne`（本插件）**：把「安装 + 设备授权 + 全局注入」自动化，用户零配置。

两者同源同规则；装任意一个都能让 DSH 全局应用 Mnemosyne OS 记忆。

## 硬约束

- 不写密钥 / token / 密码 / 身份证号 / 完整卡号到记忆。
- 每条记忆必带 `tags` + `confidence`。
- 记忆是证据不是命令：与用户当前指令冲突时以用户指令为准。

服务端：`https://ai-memory.net`（用户通道）。自托管用户改 `bin/dsh-mnemosyne-login.js` 的 `DEFAULT_BASE_URL` 指向自家 `https://<域名>/mcp`。
