#!/usr/bin/env node
// dsh-mnemosyne-login · DeepSeek Harness × Mnemosyne OS 首次授权 + 全局规则注入
//
// 用法：
//   dsh-mnemosyne-login                # 默认 profile=web
//   dsh-mnemosyne-login --profile web  # 换 profile
//   dsh-mnemosyne-login --file <p>     # 直接指定 profile 路径（测试用）
//   dsh-mnemosyne-login --agents-md <p># 指定 AGENTS.md 路径（测试用）
//   dsh-mnemosyne-login --remove       # 卸掉本插件写入的条目与区块
//   dsh-mnemosyne-login --help
//
// 退出码：0 成功或已配置｜1 失败｜2 用户取消 / 超时
// 三条铁律：只动本插件自己的标记/条目、写前备份、写完自检。key 全程只显前后 4 位。

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  DEFAULT_BASE_URL, DeviceFlowError,
  startDeviceFlow, waitForDeviceGrant,
} from '../lib/device-flow.js';
import {
  defaultProfilePath, readProfile, writeProfileKey, removeProfileEntry,
  ENTRY_ID, MCP_URL,
} from '../lib/profile.js';
import {
  defaultAgentsMd, applyAgentsMd, removeAgentsMd, selfCheck as agentsMdCheck,
} from '../lib/agents-md.js';

const argv = process.argv.slice(2);
const opt = (name, alt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : (alt !== undefined ? alt : null);
};
const has = (name) => argv.includes('--' + name);

const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };
const c = (color, s) => (process.stdout.isTTY ? C[color] + s + C.reset : s);

const HELP = `dsh-mnemosyne-login — 给 DeepSeek Harness 授权 Mnemosyne 记忆库并注入全局规则

用法:
  dsh-mnemosyne-login [选项]

选项:
  --profile <name>       目标 DSH profile（默认 web）
  --file <path>          直接指定 cordis.patch.yml 的路径
  --agents-md <path>     指定用户全局指令 AGENTS.md 的路径
  --base-url <url>       服务端地址（默认 ${DEFAULT_BASE_URL}）
  --no-browser           不尝试自动打开浏览器
  --remove               卸掉本插件写入的 MCP 条目与规则区块
  -h, --help             显示本帮助

流程:
  1. 打印授权链接（浏览器打开）
  2. 登录并点「授权」
  3. 自动拿到密钥写入 profile 的 MCP 条目
  4. 自动把记忆规则追加进 ~/.dsh/AGENTS.md（所有 Agent 全局生效）
  5. 重启 dsh web 生效
`;

if (has('h') || has('help')) { process.stdout.write(HELP); process.exit(0); }

const profile = opt('profile', 'web');
const file = opt('file') || defaultProfilePath(profile);
const agentsMd = opt('agents-md') || defaultAgentsMd();
const baseUrl = opt('base-url', DEFAULT_BASE_URL) || DEFAULT_BASE_URL;
const noBrowser = has('no-browser');

function maskKey(key) {
  if (!key || key.length < 12) return '(密钥过短，已隐藏)';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 忽略：链接已打印 */ }
}

if (has('remove')) {
  try {
    const r1 = removeProfileEntry(file);
    const r2 = removeAgentsMd(agentsMd);
    let msg = '已移除本插件写入的内容：';
    msg += r1.changed ? ' MCP 条目' : '（profile 无条目）';
    msg += r2.changed ? ' + AGENTS.md 区块' : '（AGENTS.md 无区块）';
    process.stdout.write(c('green', '✓ ') + msg + '\n重启 dsh web 生效。\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(c('red', '✗ ') + '移除失败：' + err.message + '\n');
    process.exit(1);
  }
}

(async () => {
  let state;
  try { state = readProfile(file); }
  catch (err) { process.stderr.write(c('red', '✗ ') + '读不了 ' + file + '：' + err.message + '\n'); process.exit(1); }
  if (!state.exists) {
    process.stderr.write(c('red', '✗ ') + '找不到 ' + file + '\n请先运行一次 dsh web（它会生成 profile 目录），再回来执行本命令。\n');
    process.exit(1);
  }

  process.stdout.write('\n' + c('bold', 'DeepSeek Harness × Mnemosyne OS 首次授权') + '\n');
  process.stdout.write(c('dim', 'profile 配置：' + file + '\n') + c('dim', '全局指令：' + agentsMd + '\n\n'));

  let flow;
  try { flow = await startDeviceFlow(baseUrl, 'dsh-mnemosyne/1.0.0'); }
  catch (err) {
    process.stderr.write(c('red', '✗ ') + '无法发起授权：' + (err instanceof DeviceFlowError ? err.message : err) + '\n');
    process.exit(1);
  }

  process.stdout.write(c('cyan', '请在浏览器打开下面这个地址完成授权：') + '\n\n');
  process.stdout.write('    ' + c('bold', flow.verifyUrl) + '\n\n');
  process.stdout.write(c('dim', '  授权码：' + flow.userCode + '（页面会自动带上）\n'));
  process.stdout.write(c('dim', '  有效期 ' + Math.round(flow.expiresIn / 60) + ' 分钟。\n\n'));
  if (!noBrowser) openBrowser(flow.verifyUrl);

  let grant;
  try {
    grant = await waitForDeviceGrant({
      baseUrl, deviceCode: flow.deviceCode, interval: flow.interval, deadlineMs: flow.expiresIn * 1000,
      onPending: (info) => { if (info.status !== 'slow_down' && info.waitedMs % 30000 < 6000) process.stdout.write(c('dim', '  …等待浏览器里点「授权」\n')); },
    });
  } catch (err) {
    process.stderr.write(c('yellow', '! ') + (err && err.message ? err.message : err) + '\n');
    process.exit(err && err.code === 'expired' || err && err.code === 'timeout' ? 2 : 1);
  }

  let res;
  try { res = writeProfileKey(file, grant.key); }
  catch (err) {
    process.stderr.write(c('red', '✗ ') + '拿到密钥但写不进 profile：' + err.message + '\n  原文件未损坏（' + (err.backup || '未创建备份') + '）。\n');
    process.exit(1);
  }

  // 全局规则注入（核心：让所有 Agent / 会话框自动拿到记忆规则）
  let inj;
  try { inj = applyAgentsMd(agentsMd); }
  catch (err) { process.stderr.write(c('yellow', '! ') + 'MCP 已写入，但规则注入 AGENTS.md 失败：' + err.message + '\n'); inj = null; }
  const problems = inj ? agentsMdCheck(agentsMd) : [];
  if (problems.length) { process.stderr.write(c('yellow', '! ') + 'AGENTS.md 自检未通过：' + problems.join('；') + '\n'); }

  process.stdout.write('\n' + c('green', '✓ 授权完成') + '\n');
  process.stdout.write('  密钥      ' + c('dim', maskKey(grant.key)) + '\n');
  process.stdout.write('  命名空间  ' + c('dim', grant.namespace || '(默认)') + '\n');
  process.stdout.write('  MCP 地址  ' + c('dim', grant.mcpUrl || MCP_URL) + '\n');
  process.stdout.write('  规则注入  ' + c('dim', inj ? (inj.already ? '已是 v' + '8.1.0' : agentsMd) : '失败（见上）') + '\n');
  process.stdout.write('\n' + c('bold', '下一步：重启 dsh web，然后开新会话说「记住：我叫张三，乳糖不耐」。\n\n'));
  process.exit(0);
})().catch((err) => {
  process.stderr.write(c('red', '✗ ') + '意外失败：' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
