/**
 * Host half of the OpenCode Go usage bundle.
 *
 * OpenCode Go meters three windows per plan: a rolling 5-hour window, the UTC
 * calendar week, and the paid period (month). The gateway reports them at
 * `GET {baseURL}/usage` for the API key that pays for the plan.
 *
 * This half owns the key and the on/off choice, both stored in the Harness
 * credential store under this plugin's own keys — never read from another
 * provider's credential and never written into a settings file:
 *   OPENCODE_GO_API_KEY          the user's own OpenCode key (oc_sk_…)
 *   OPENCODE_GO_USAGE_ENABLED    '1' (default) or '0'
 *
 * The browser half cannot reach the gateway itself, so this half serves one
 * authenticated state route and one settings route; the key never reaches the
 * page, only a masked hint of it.
 *
 * No Config is declared: a profile-installed bundle cannot resolve the Harness
 * installation's own packages (such as the schema library).
 */

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const DEFAULT_KEY_REF = 'OPENCODE_GO_API_KEY';
const DEFAULT_ENABLED_REF = 'OPENCODE_GO_USAGE_ENABLED';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_MS = 30000;

/** Absolute pathnames the Host registers; the browser addresses them document-relative. */
const STATE_PATH = '/opencode-go/state';
const SETTINGS_PATH = '/opencode-go/settings';

/** The three windows OpenCode Go meters, in display order. */
const WINDOWS = ['rolling', 'weekly', 'monthly'];

export const name = 'opencode-go-usage';

export const inject = ['webServer', 'connection'];

/** JSON response; quota numbers are live facts, so nothing is cached by the browser. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** 405 naming the route's supported methods. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405;
  res.setHeader('allow', allow);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: { code: 'method-not-allowed', message: `use ${allow}` } }));
}

/** Settings payloads are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Show enough of a key to recognize it, never enough to use it. */
function hintOf(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length <= 10) return '••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Normalize one metered window; unknown fields never reach the browser half. */
function normalizeWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const percent = typeof raw.percent === 'number' && Number.isFinite(raw.percent) ? raw.percent : null;
  const resetsAt = typeof raw.resetsAt === 'string' ? raw.resetsAt : null;
  const status = typeof raw.status === 'string' ? raw.status : null;
  if (percent === null && resetsAt === null && status === null) return null;
  return { percent, resetsAt, status };
}

/** Read one upstream payload into the shape the browser half renders. */
function normalizeUsage(body) {
  const usage =
    body !== null && typeof body === 'object' && body.usage !== null && typeof body.usage === 'object' ? body.usage : {};
  const windows = {};
  let seen = 0;
  for (const key of WINDOWS) {
    const window = normalizeWindow(usage[key]);
    windows[key] = window;
    if (window !== null) seen += 1;
  }
  if (seen === 0) return null;
  return windows;
}

export function apply(ctx, config) {
  const supplied = config !== null && typeof config === 'object' ? config : {};
  const options = {
    keyRef: typeof supplied.credentialRef === 'string' ? supplied.credentialRef : DEFAULT_KEY_REF,
    enabledRef: typeof supplied.enabledRef === 'string' ? supplied.enabledRef : DEFAULT_ENABLED_REF,
    baseURL: String(typeof supplied.baseURL === 'string' ? supplied.baseURL : DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs: typeof supplied.timeoutMs === 'number' ? supplied.timeoutMs : DEFAULT_TIMEOUT_MS,
    cacheMs: typeof supplied.cacheMs === 'number' ? supplied.cacheMs : DEFAULT_CACHE_MS,
  };

  const credentials = ctx.get('credentials');

  /** Last gateway answer and the moment it was taken; the UI polls faster than the gateway should be hit. */
  let cache = { at: 0, key: '', payload: undefined };
  let inflight;

  /** Read one stored credential value, treating present-but-empty as absent. */
  const resolveValue = async (ref) => {
    if (credentials === undefined) return undefined;
    try {
      const hit = await credentials.resolve(ref);
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) {
        return { value: hit.value, source: typeof hit.source === 'string' ? hit.source : null };
      }
    } catch {
      // A broken store reads as unconfigured; the settings page reports the write failure instead.
    }
    return undefined;
  };

  const readEnabled = async () => {
    const stored = await resolveValue(options.enabledRef);
    return stored === undefined ? true : stored.value !== '0';
  };

  const store = async (ref, value) => {
    if (credentials === undefined) throw new Error('此部署没有可写的凭证库。');
    await credentials.set(ref, value);
  };

  const remove = async (ref) => {
    if (credentials === undefined) return;
    await credentials.unset(ref);
  };

  const fetchUsage = async (key) => {
    try {
      const response = await fetch(`${options.baseURL}/usage`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${key}`,
          accept: 'application/json',
          'user-agent': 'dsh-opencode-go-usage/1.0',
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream';
        return {
          windows: null,
          error: {
            code,
            httpStatus: response.status,
            message:
              code === 'unauthorized'
                ? '密钥被拒绝；请在设置中检查 OpenCode API key。'
                : detail.length > 0
                  ? detail.slice(0, 300)
                  : `HTTP ${response.status}`,
          },
        };
      }
      const windows = normalizeUsage(await response.json());
      if (windows === null) {
        return { windows: null, error: { code: 'unexpected-payload', message: '额度接口返回了无法识别的结构。' } };
      }
      return { windows, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { windows: null, error: { code: 'network', message } };
    }
  };

  /** One snapshot of everything the UI needs: the choice, the key's presence, and the numbers. */
  const buildState = async (force) => {
    const [enabled, stored, info] = await Promise.all([
      readEnabled(),
      resolveValue(options.keyRef),
      Promise.resolve(credentials === undefined ? undefined : credentials.describe(options.keyRef)).catch(() => undefined),
    ]);

    const base = {
      ok: true,
      enabled,
      configured: stored !== undefined,
      source: stored !== undefined ? stored.source : null,
      writable: info !== undefined && info !== null && info.writable === true,
      keyHint: stored !== undefined ? hintOf(stored.value) : null,
      origin: options.baseURL,
    };

    if (!enabled) {
      return { ...base, usage: null, error: null, fetchedAt: new Date().toISOString() };
    }
    if (stored === undefined) {
      return {
        ...base,
        usage: null,
        error: { code: 'missing-credential', message: '尚未填写 OpenCode API key。' },
        fetchedAt: new Date().toISOString(),
      };
    }

    const now = Date.now();
    if (!force && cache.payload !== undefined && cache.key === stored.value && now - cache.at < options.cacheMs) {
      return { ...base, usage: cache.payload, error: null, fetchedAt: new Date(cache.at).toISOString() };
    }
    if (!force && inflight !== undefined) {
      const settled = await inflight;
      return { ...base, usage: settled.windows, error: settled.error, fetchedAt: new Date().toISOString() };
    }

    inflight = fetchUsage(stored.value);
    let settled;
    try {
      settled = await inflight;
    } finally {
      inflight = undefined;
    }
    if (settled.windows !== null) cache = { at: Date.now(), key: stored.value, payload: settled.windows };
    return { ...base, usage: settled.windows, error: settled.error, fetchedAt: new Date().toISOString() };
  };

  /** Answer an untrusted or unauthenticated request; true when it was rejected. */
  const rejected = (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (req, res) => {
          if (rejected(req, res)) return;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendMethodNotAllowed(res, 'GET');
            return;
          }
          const url = new URL(String(req.url ?? '/'), 'http://localhost');
          const force = url.searchParams.get('refresh') === '1';
          try {
            sendJson(res, 200, await buildState(force));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 500, { ok: false, error: { code: 'internal', message } });
          }
        },
      }),
    `opencode-go-usage: GET ${STATE_PATH}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SETTINGS_PATH,
        handler: async (req, res) => {
          if (rejected(req, res)) return;
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST');
            return;
          }
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { ok: false, error: { code: 'invalid-body', message } });
            return;
          }
          try {
            if (typeof body.enabled === 'boolean') {
              await store(options.enabledRef, body.enabled ? '1' : '0');
            }
            if (body.apiKey === null) {
              await remove(options.keyRef);
            } else if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
              await store(options.keyRef, body.apiKey.trim());
            }
            sendJson(res, 200, await buildState(true));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { ok: false, error: { code: 'write-failed', message } });
          }
        },
      }),
    `opencode-go-usage: POST ${SETTINGS_PATH}`,
  );
}
