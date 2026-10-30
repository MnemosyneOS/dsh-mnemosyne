// dsh-mnemosyne · 用户 profile 的幂等写入（保注释、先备份、写完自检）
//
// 目标文件是用户 profile 的 cordis.patch.yml —— 顶层 YAML 数组，通常还有手写注释。
// 只做文本级判断，不引第三方 YAML 解析器（引解析器会把注释洗掉）。

import fs from 'node:fs';
import path from 'node:path';

export const ENTRY_ID = 'mcp-mnemosyne';
export const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client';
export const SERVER_NAME = 'mnemosyne';
export const MCP_URL = 'https://ai-memory.net/v1/mcp';

export class ProfileWriteError extends Error {
  constructor(message, code = 'profile_error') {
    super(message);
    this.name = 'ProfileWriteError';
    this.code = code;
  }
}

export function entryBlock(key) {
  return [
    '- insert:',
    '    - id: ' + ENTRY_ID,
    "      name: '" + MCP_PLUGIN_NAME + "'",
    '      config:',
    '        serverName: ' + SERVER_NAME,
    '        transport: streamable-http',
    '        url: ' + MCP_URL,
    '        headers:',
    '          Authorization: Bearer ' + key,
  ].join('\n');
}

function findMnemosyneEntryLines(text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^\\s*-\\s+id:\\s*' + ENTRY_ID + '\\s*$').test(lines[i])) hits.push(i);
    else if (/^\s*serverName:\s*mnemosyne\s*$/.test(lines[i]) && !hits.includes(i)) hits.push(i);
  }
  return { lines, hits: hits.sort((a, b) => a - b) };
}

function entryHasRealKey(lines, startIdx) {
  for (let i = startIdx; i < Math.min(lines.length, startIdx + 14); i++) {
    const m = /^\s*Authorization:\s*Bearer\s+(\S+)\s*$/.exec(lines[i] || '');
    if (m) return /^mn-/.test(m[1]);
  }
  return false;
}

function selfCheck(text) {
  const problems = [];
  const body = text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n').trim();
  // 允许空数组占位 `[]`：剥掉后仍以 `-` 开头的块序列才是合法顶层数组
  const norm = body.replace(/^\[\]\s*/, '').trimStart();
  if (norm && !norm.startsWith('-')) problems.push('顶层不是 YAML 数组');
  const { lines, hits } = findMnemosyneEntryLines(text);
  if (hits.length === 0) problems.push('找不到 mnemosyne 条目');
  const auth = lines.filter((l) => /^\s*Authorization:\s*Bearer\s+mn-\S+\s*$/.test(l));
  if (auth.length !== 1) problems.push('Authorization 真 key 行数=' + auth.length + '（应为1）');
  if (hits.length === 1 && !entryHasRealKey(lines, hits[0])) problems.push('条目里没有真 key');
  return problems;
}

export function defaultProfilePath(profile = 'web') {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.dsh', 'profiles', profile, 'cordis.patch.yml');
}

export function readProfile(file) {
  if (!fs.existsSync(file)) return { exists: false, configured: false, text: '' };
  const text = fs.readFileSync(file, 'utf8');
  const { lines, hits } = findMnemosyneEntryLines(text);
  const configured = hits.length > 0 && entryHasRealKey(lines, hits[0]);
  return { exists: true, configured, text };
}

export function writeProfileKey(file, key) {
  const state = readProfile(file);
  if (!state.exists) {
    throw new ProfileWriteError('找不到配置文件：' + file + '\n请先运行一次 dsh web 生成 profile。', 'missing_file');
  }
  if (state.configured) return { changed: false, already: true, backup: null };
  const original = state.text;
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const { hits } = findMnemosyneEntryLines(original);
  let next;
  if (hits.length > 0) {
    next = lines.slice();
    const start = hits[0];
    let replaced = false;
    for (let i = start; i < Math.min(next.length, start + 14); i++) {
      if (/^\s*Authorization:\s*Bearer\s+\S+\s*$/.test(next[i])) {
        const indent = /^(\s*)/.exec(next[i])[1];
        next[i] = indent + 'Authorization: Bearer ' + key; replaced = true; break;
      }
    }
    if (!replaced) {
      for (let i = start; i < Math.min(next.length, start + 14); i++) {
        if (/^\s*url:\s*\S+/.test(next[i])) { next.splice(i + 1, 0, '        headers:', '          Authorization: Bearer ' + key); break; }
      }
    }
  } else {
    const tail = original.length && !original.endsWith('\n') ? [eol] : [];
    next = lines.concat(tail, '- insert:', '    - id: ' + ENTRY_ID,
                        "      name: '" + MCP_PLUGIN_NAME + "'", '      config:',
                        '        serverName: ' + SERVER_NAME,
                        '        transport: streamable-http',
                        '        url: ' + MCP_URL, '        headers:',
                        '          Authorization: Bearer ' + key);
  }
  const written = next.join(eol);
  const problems = selfCheck(written);
  if (problems.length) {
    throw new ProfileWriteError('写入前自检未通过，未改动原文件：' + problems.join('；'), 'selfcheck');
  }
  const backup = file + '.bak-dsh-mnemosyne';
  fs.writeFileSync(backup, original, 'utf8');
  try {
    fs.writeFileSync(file, written, 'utf8');
  } catch (err) {
    try { fs.copyFileSync(backup, file); } catch { /* ignore */ }
    throw new ProfileWriteError('写入失败并已回滚：' + err.message, 'write_failed');
  }
  return { changed: true, already: false, backup };
}

export function removeProfileEntry(file) {
  const state = readProfile(file);
  if (!state.exists || !state.text) return { changed: false };
  const eol = state.text.includes('\r\n') ? '\r\n' : '\n';
  const { lines, hits } = findMnemosyneEntryLines(state.text);
  if (!hits.length) return { changed: false };
  let start = hits[0];
  while (start > 0 && lines[start - 1].trim() === '') start--;
  let end = start;
  while (end < lines.length && !/^- /.test(lines[end])) end++;
  let start2 = start;
  while (start2 > 0 && /^- insert:\s*$/.test(lines[start2 - 1])) start2--;
  const next = lines.slice(0, start2).concat(lines.slice(end));
  fs.writeFileSync(file, next.join(eol), 'utf8');
  return { changed: true };
}
