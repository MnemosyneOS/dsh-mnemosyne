// dsh-mnemosyne · Device Flow 客户端逻辑（零依赖，复用 dsh-ai-memory 协议）
//
// 只做协议，不碰文件系统：bin/ 里的 CLI 负责打印与写配置。
// 三个硬约束：
//   ① User-Agent 必须显式设成 `dsh-mnemosyne/<version>`（Cloudflare 会拦默认 UA）。
//   ② interval 由服务端给，客户端只在它基础上加码。
//   ③ key 只在内存里出现一次：拿到后立刻交给调用方，这里不落日志、不落盘。

export const DEFAULT_BASE_URL = 'https://ai-memory.net';
export const USER_AGENT = 'dsh-mnemosyne/1.0.0';

export class DeviceFlowError extends Error {
  constructor(message, code = 'device_flow_error', status = 0) {
    super(message);
    this.name = 'DeviceFlowError';
    this.code = code;
    this.status = status;
  }
}

function joinUrl(base, p) {
  return String(base || DEFAULT_BASE_URL).replace(/\/+$/, '') + p;
}

async function postJson(url, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new DeviceFlowError('请求 ai-memory.net 超时，请检查网络后重试。', 'timeout');
    }
    throw new DeviceFlowError('连不上 ai-memory.net：' + (err && err.message ? err.message : err), 'network');
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  }
  if (!resp.ok) {
    const msg = (data && (data.message || data.error)) || ('HTTP ' + resp.status);
    throw new DeviceFlowError(String(msg), 'http_' + resp.status, resp.status);
  }
  return data;
}

export async function startDeviceFlow(baseUrl, client = 'dsh-mnemosyne') {
  const data = await postJson(joinUrl(baseUrl, '/api/device/start'), { client });
  if (!data.device_code || !data.user_code || !data.verify_url) {
    throw new DeviceFlowError('服务端返回缺少必要字段：' + JSON.stringify(data).slice(0, 200), 'bad_response');
  }
  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verifyUrl: String(data.verify_url),
    interval: Math.max(1, Number(data.interval) || 5),
    expiresIn: Number(data.expires_in) || 600,
  };
}

export async function pollDeviceFlow(baseUrl, deviceCode) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let resp;
  try {
    resp = await fetch(joinUrl(baseUrl, '/api/device/poll'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ device_code: deviceCode }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new DeviceFlowError('请求 ai-memory.net 超时，请检查网络后重试。', 'timeout');
    }
    throw new DeviceFlowError('连不上 ai-memory.net：' + (err && err.message ? err.message : err), 'network');
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; } }
  if (resp.status === 503 && data && data.status === 'pending') {
    return { status: 'pending', key: '', mcpUrl: '', namespace: '' };
  }
  if (!resp.ok) {
    const msg = (data && (data.message || data.error)) || ('HTTP ' + resp.status);
    throw new DeviceFlowError(String(msg), 'http_' + resp.status, resp.status);
  }
  return {
    status: String(data.status || ''),
    key: data.key ? String(data.key) : '',
    mcpUrl: data.mcp_url ? String(data.mcp_url) : '',
    namespace: data.namespace ? String(data.namespace) : '',
  };
}

export async function waitForDeviceGrant(opts) {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const deviceCode = opts.deviceCode;
  let intervalSec = Math.max(1, Number(opts.interval) || 5);
  const deadline = Date.now() + (Number(opts.deadlineMs) || 600000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const res = await pollDeviceFlow(baseUrl, deviceCode);
    if (res.status === 'ok') {
      if (!res.key) throw new DeviceFlowError('服务端返回 status=ok 但没有密钥。', 'bad_response');
      return { key: res.key, mcpUrl: res.mcpUrl, namespace: res.namespace };
    }
    if (res.status === 'expired') throw new DeviceFlowError('授权请求已过期，请重新运行本命令。', 'expired');
    if (res.status === 'slow_down') intervalSec = Math.min(intervalSec * 2, 30);
    if (opts.onPending) {
      opts.onPending({ status: res.status, waitedMs: (Number(opts.deadlineMs) || 600000) - (deadline - Date.now()) });
    }
    if (Date.now() + intervalSec * 1000 > deadline) {
      throw new DeviceFlowError('等待授权超时（10 分钟），请重新运行本命令。', 'timeout');
    }
    await sleep(intervalSec * 1000);
  }
}
