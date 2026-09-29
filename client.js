/**
 * Browser half of the OpenCode Go usage bundle.
 *
 * Two surfaces share one Host-owned state:
 *   1. `conversation.composer.dock` — three pills beside the host's own stats
 *      pills, rendered only while the feature is on and a key is configured.
 *   2. `settings.section` — the page that turns the feature on or off and
 *      stores the user's own OpenCode key.
 *
 * Styling copies the host's primitives rather than importing them: pill metrics
 * from the composer stats pills, and the field / switch / input / save rules
 * from `@deepseek-ai/dsh-client-ui-primitives`. The key never reaches this half;
 * the Host serves a masked hint only.
 */
window.__ModuleLoader__.load({
  id: '@local/opencode-go-quota',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Document-relative forms first (mount proxies keep a prefix); the absolute form is the fallback. */
    const STATE_ROUTES = ['opencode-go/state', '/opencode-go/state'];
    const SETTINGS_ROUTES = ['opencode-go/settings', '/opencode-go/settings'];
    const REFRESH_MS = 60000;
    const FRESH_MS = 15000;
    const WARN_AT = 70;
    const ALERT_AT = 90;

    const WINDOWS = [
      { key: 'rolling', label: '5 小时', icon: 'clock' },
      { key: 'weekly', label: '本周', icon: 'calendar' },
      { key: 'monthly', label: '本月', icon: 'card' },
    ];

    /** One request per route list, document-relative first. */
    async function requestJson(routes, init) {
      let lastError = null;
      for (const route of routes) {
        try {
          const response = await fetch(route, {
            cache: 'no-store',
            ...init,
            headers: { accept: 'application/json', ...(init !== undefined && init.headers !== undefined ? init.headers : {}) },
          });
          if (response.status === 404) {
            lastError = new Error('额度路由未注册');
            continue;
          }
          const body = await response.json().catch(() => null);
          if (body === null) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }
          return body;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error('请求失败');
    }

    /** One shared snapshot: both surfaces read it, and either write publishes to the other. */
    const store = (() => {
      let value = null;
      let at = 0;
      let inflight = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) listener(value);
      };
      const commit = (next) => {
        value = next;
        at = Date.now();
        emit();
      };
      return {
        get: () => value,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async load(force) {
          if (!force && value !== null && Date.now() - at < FRESH_MS) return value;
          if (inflight !== null) return inflight;
          inflight = (async () => {
            const next = await requestJson(force ? STATE_ROUTES.map((route) => `${route}?refresh=1`) : STATE_ROUTES);
            if (next !== null && next.ok === true) commit(next);
            return next;
          })();
          try {
            return await inflight;
          } finally {
            inflight = null;
          }
        },
        async save(payload) {
          const next = await requestJson(SETTINGS_ROUTES, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (next !== null && next.ok === true) commit(next);
          return next;
        },
      };
    })();

    function useStoreState() {
      const [state, setState] = React.useState(store.get());
      React.useEffect(() => store.subscribe(setState), []);
      return state;
    }

    function toneOf(percent) {
      if (percent === null) return '';
      if (percent >= ALERT_AT) return 'ocg-alert';
      if (percent >= WARN_AT) return 'ocg-warn';
      return '';
    }

    function colorFor(percent) {
      if (percent === null) return 'var(--dsw-alias-state-idle-primary)';
      if (percent >= ALERT_AT) return 'var(--dsw-alias-state-error-primary)';
      if (percent >= WARN_AT) return 'var(--dsw-alias-state-warn-primary)';
      return 'var(--dsw-alias-brand-primary)';
    }

    function formatReset(iso) {
      if (typeof iso !== 'string') return '重置时间未知';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '重置时间未知';
      const remaining = at.getTime() - Date.now();
      if (remaining <= 0) return '即将重置';
      const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (remaining < 24 * 3600 * 1000) return `${time} 重置`;
      return `${at.getMonth() + 1}/${at.getDate()} ${time} 重置`;
    }

    function formatClock(iso) {
      if (typeof iso !== 'string') return '';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '';
      return `${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 更新`;
    }

    /** 14px stroked glyphs in the host's icon weight, inheriting the pill colour. */
    function Glyph(props) {
      const common = {
        viewBox: '0 0 14 14',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      };
      if (props.name === 'calendar') {
        return h(
          'svg',
          common,
          h('rect', { key: 'b', x: 1.6, y: 2.8, width: 10.8, height: 9.6, rx: 1.8 }),
          h('path', { key: 'l', d: 'M1.6 6h10.8' }),
          h('path', { key: 't', d: 'M4.6 1.6v2.4M9.4 1.6v2.4' }),
        );
      }
      if (props.name === 'card') {
        return h(
          'svg',
          common,
          h('rect', { key: 'b', x: 1.4, y: 3.2, width: 11.2, height: 8, rx: 1.8 }),
          h('path', { key: 's', d: 'M1.4 6.2h11.2' }),
          h('path', { key: 'c', d: 'M4 8.9h3' }),
        );
      }
      return h(
        'svg',
        common,
        h('circle', { key: 'c', cx: 7, cy: 7, r: 5.4 }),
        h('path', { key: 'h', d: 'M7 3.9V7.3l2.2 1.3' }),
      );
    }

    /** The three-bar gauge used inside the panel title. */
    function Gauge() {
      const bars = [];
      for (let index = 0; index < 3; index += 1) {
        bars.push(h('rect', { key: index, x: 1.5, y: 2.4 + index * 3.6, width: 11, height: 1.9, rx: 0.95 }));
      }
      return h('svg', { viewBox: '0 0 14 14', fill: 'currentColor', 'aria-hidden': true }, ...bars);
    }

    /** Host pill metrics: 12px figures, 20px line box, 999px radius, 14px glyph. */
    const PILL_CSS = `
.ocg-root {
  box-sizing: border-box; min-width: 0; max-width: 100%; display: flex; justify-content: center; gap: 12px;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}
.ocg-anchor { min-width: 0; display: inline-flex; }
.ocg-pill {
  box-sizing: border-box; corner-shape: round; max-width: 100%; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-variant-numeric: tabular-nums; line-height: inherit; white-space: nowrap;
  background: 0 0; border: none; border-radius: 999px; cursor: pointer;
  align-items: center; gap: 6px; padding: 1px 8px; display: inline-flex;
}
.ocg-pill svg { flex: none; width: 14px; height: 14px; }
.ocg-pill:hover, .ocg-pill[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
.ocg-pill:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}
.ocg-pill.ocg-warn { color: var(--dsw-alias-state-warn-primary); }
.ocg-pill.ocg-alert { color: var(--dsw-alias-state-error-primary); }
.ocg-label { text-overflow: ellipsis; min-width: 0; overflow: hidden; }
.ocg-value { font-variant-numeric: tabular-nums; }
.ocg-panel {
  z-index: 1100; box-sizing: border-box; position: fixed; width: max-content;
  min-width: min(272px, 100vw - 24px); max-width: min(340px, 100vw - 24px);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay));
  backdrop-filter: var(--dsw-menu-backdrop-filter); box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-secondary); cursor: default; border: 0; padding: 16px;
  font-size: 12px; line-height: 18px;
}
.ocg-panel-title {
  color: var(--dsw-alias-label-primary); justify-content: space-between; align-items: center;
  gap: 16px; margin-bottom: 8px; font-weight: 500; display: flex;
}
.ocg-panel-label { align-items: center; gap: 6px; min-width: 0; display: inline-flex; }
.ocg-panel-label svg { flex: none; width: 14px; height: 14px; }
.ocg-panel-value { font-variant-numeric: tabular-nums; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.ocg-rule { border-top: .5px solid var(--dsw-alias-border-l2); margin-bottom: 10px; }
.ocg-row { display: flex; align-items: center; gap: 10px; }
.ocg-row + .ocg-row { margin-top: 9px; }
.ocg-row-label { flex: none; width: 44px; color: var(--dsw-alias-label-secondary); }
.ocg-track {
  flex: 1 1 auto; height: 6px; border-radius: 999px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2); border: .5px solid var(--dsw-alias-border-l1);
}
.ocg-fill { height: 100%; border-radius: 999px; transition: width .3s ease; }
.ocg-row-value { flex: none; width: 34px; text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.ocg-reset { margin: 2px 0 0 54px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ocg-error { color: var(--dsw-alias-state-error-primary); word-break: break-word; }
`;

    function GoUsagePills() {
      const state = useStoreState();
      const rootRef = React.useRef(null);
      const [open, setOpen] = React.useState(false);
      const [anchor, setAnchor] = React.useState(null);

      React.useEffect(() => {
        let cancelled = false;
        const tick = () => {
          if (cancelled) return;
          store.load(false).catch(() => {});
        };
        tick();
        const timer = setInterval(tick, REFRESH_MS);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, []);

      /** Place the panel above the pill row; the dock sits under the composer card. */
      const measure = React.useCallback(() => {
        const node = rootRef.current;
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
          window.removeEventListener('resize', measure);
          window.removeEventListener('scroll', measure, true);
        };
      }, [open, measure]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const root = rootRef.current;
          if (root === null) return;
          const target = event.target;
          if (target instanceof Node && root.contains(target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      const usage = state !== null && state.usage !== null && state.usage !== undefined ? state.usage : null;
      if (state === null || state.enabled !== true || state.configured !== true || usage === null) return null;

      const rows = WINDOWS.map((entry) => {
        const data = usage[entry.key] ?? null;
        const percent = data !== null && typeof data.percent === 'number' ? data.percent : null;
        return { key: entry.key, label: entry.label, icon: entry.icon, data, percent };
      });

      const panel =
        open && anchor !== null
          ? h(
              'div',
              {
                className: 'ocg-panel',
                style: { left: `${anchor.left}px`, bottom: `${anchor.bottom}px` },
                role: 'dialog',
                'aria-label': 'OpenCode Go 额度',
              },
              h(
                'div',
                { className: 'ocg-panel-title' },
                h('span', { className: 'ocg-panel-label' }, h(Gauge, null), 'OpenCode Go'),
                h('span', { className: 'ocg-panel-value' }, formatClock(state.fetchedAt)),
              ),
              h('div', { className: 'ocg-rule' }),
              rows.map((row) =>
                h(
                  'div',
                  { key: row.key },
                  h(
                    'div',
                    { className: 'ocg-row' },
                    h('span', { className: 'ocg-row-label' }, row.label),
                    h(
                      'div',
                      { className: 'ocg-track' },
                      h('div', {
                        className: 'ocg-fill',
                        style: {
                          width: `${row.percent === null ? 0 : Math.max(0, Math.min(100, row.percent))}%`,
                          background: colorFor(row.percent),
                        },
                      }),
                    ),
                    h('span', { className: 'ocg-row-value' }, row.percent === null ? '—' : `${Math.round(row.percent)}%`),
                  ),
                  h('div', { className: 'ocg-reset' }, row.data === null ? '无数据' : formatReset(row.data.resetsAt)),
                ),
              ),
            )
          : null;

      return h(
        'div',
        { ref: rootRef, className: 'ocg-root' },
        h('style', { key: 'ocg-pill-css' }, PILL_CSS),
        rows.map((row) =>
          h(
            'span',
            { key: row.key, className: 'ocg-anchor' },
            h(
              'button',
              {
                type: 'button',
                className: `ocg-pill ${toneOf(row.percent)}`.trim(),
                'aria-haspopup': 'dialog',
                'aria-expanded': open,
                'aria-label': `OpenCode Go ${row.label} 额度 ${row.percent === null ? '未知' : `${Math.round(row.percent)}%`}`,
                onClick: () => {
                  setOpen((previous) => !previous);
                  if (!open) store.load(true).catch(() => {});
                },
              },
              h(Glyph, { name: row.icon }),
              h('span', { className: 'ocg-label' }, row.label),
              h('span', { className: 'ocg-value' }, row.percent === null ? '—' : `${Math.round(row.percent)}%`),
            ),
          ),
        ),
        panel,
      );
    }

    /** Field, switch, input and save rules copied from the host's settings form and primitives. */
    const FORM_CSS = `
.ocg-form { display: flex; flex-direction: column; }
.ocg-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.ocg-field + .ocg-field { border-top: .5px solid var(--dsw-alias-border-l2); }
.ocg-head { display: flex; align-items: center; gap: 8px; }
.ocg-field-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary);
}
.ocg-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.ocg-input {
  height: 34px; padding: 0 12px; border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3);
  font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary);
}
.ocg-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.ocg-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.ocg-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.ocg-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px;
  padding: 2px; border: 0; border-radius: 999px; corner-shape: round;
  background: var(--dsw-alias-border-l3); cursor: pointer;
}
.ocg-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.ocg-switch:disabled { cursor: default; opacity: .5; }
.ocg-switch:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.ocg-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-label-primary-foreground); transition: transform 120ms ease;
}
.ocg-switch[aria-checked="false"] .ocg-thumb { background: var(--dsw-alias-switch-thumb); }
.ocg-switch[aria-checked="true"] .ocg-thumb { transform: translateX(16px); }
.ocg-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }
.ocg-save {
  appearance: none; border: 1px solid transparent; border-radius: var(--dsw-radius-md);
  padding: 5px 14px; font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.ocg-save:disabled { opacity: .4; cursor: default; }
.ocg-save:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.ocg-ghost {
  appearance: none; border: .5px solid var(--dsw-alias-border-l3); background: transparent;
  border-radius: var(--dsw-radius-md); padding: 5px 14px; font: inherit; font-size: 13px;
  line-height: 1.5; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.ocg-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.ocg-ghost:disabled { opacity: .4; cursor: default; }
.ocg-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.ocg-failed { margin: 0; padding-top: 8px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-error); }
`;

    function GoUsageSettings() {
      const state = useStoreState();
      const [enabled, setEnabled] = React.useState(true);
      const [apiKey, setApiKey] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const [touched, setTouched] = React.useState(false);

      React.useEffect(() => {
        store.load(false).catch(() => {});
      }, []);

      React.useEffect(() => {
        if (state !== null && !touched) setEnabled(state.enabled === true);
      }, [state, touched]);

      const save = async (payload, note) => {
        setBusy(true);
        setMessage(null);
        try {
          const result = await store.save(payload);
          if (result !== null && result.ok === true) {
            setApiKey('');
            setTouched(false);
            setMessage(note);
          } else {
            const reason =
              result !== null && result.error !== undefined && result.error.message !== undefined
                ? result.error.message
                : '保存失败';
            setMessage(reason);
          }
        } catch (error) {
          setMessage(error !== null && error !== undefined && error.message !== undefined ? error.message : '保存失败');
        } finally {
          setBusy(false);
        }
      };

      const submit = (event) => {
        event.preventDefault();
        const payload = { enabled };
        const trimmed = apiKey.trim();
        if (trimmed.length > 0) payload.apiKey = trimmed;
        save(payload, '已保存。');
      };

      const configured = state !== null && state.configured === true;
      const writable = state === null || state.writable !== false;
      const failure =
        state !== null && state.error !== null && state.error !== undefined && state.error.code !== 'missing-credential'
          ? state.error
          : null;

      return h(
        'form',
        { className: 'ocg-form', onSubmit: submit },
        h('style', { key: 'ocg-form-css' }, FORM_CSS),
        h(
          'div',
          { className: 'ocg-field' },
          h(
            'div',
            { className: 'ocg-head' },
            h('span', { className: 'ocg-field-label' }, '显示额度'),
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                className: 'ocg-switch',
                'aria-checked': enabled,
                'aria-label': '显示额度',
                disabled: busy,
                onClick: () => {
                  setTouched(true);
                  setEnabled((previous) => !previous);
                },
              },
              h('span', { className: 'ocg-thumb' }),
            ),
          ),
          h('p', { className: 'ocg-hint' }, '在输入框下方显示 5 小时 / 本周 / 本月三个额度，和自带的统计按钮并排。'),
        ),
        h(
          'div',
          { className: 'ocg-field' },
          h('div', { className: 'ocg-head' }, h('span', { className: 'ocg-field-label' }, 'API Key')),
          h('input', {
            className: 'ocg-input',
            type: 'password',
            value: apiKey,
            placeholder: configured ? '已配置；留空表示保持不变' : 'oc_sk_…',
            autoComplete: 'off',
            spellCheck: false,
            disabled: busy || !writable,
            onChange: (event) => setApiKey(event.target.value),
          }),
          h(
            'p',
            { className: 'ocg-hint' },
            '你自己的 OpenCode API key，存在 DSH 凭证库里（OPENCODE_GO_API_KEY），不写入设置文件，也不读取其他提供方的密钥。',
          ),
          configured
            ? h(
                'p',
                { className: 'ocg-hint' },
                `当前密钥：${state.keyHint ?? '已配置'}${state.source !== null && state.source !== undefined ? ` · 来源 ${state.source}` : ''}`,
              )
            : h('p', { className: 'ocg-hint' }, '尚未配置密钥；配置后这里会显示 5 小时 / 本周 / 本月三个额度。'),
          !writable ? h('p', { className: 'ocg-failed' }, '本部署的凭证库是只读的，无法在此保存。') : null,
        ),
        failure !== null ? h('p', { className: 'ocg-failed' }, `读取失败：${failure.message}`) : null,
        h(
          'div',
          { className: 'ocg-footer' },
          h('button', { className: 'ocg-save', type: 'submit', disabled: busy || !writable }, busy ? '保存中…' : '保存'),
          configured
            ? h(
                'button',
                {
                  className: 'ocg-ghost',
                  type: 'button',
                  disabled: busy || !writable,
                  onClick: () => save({ apiKey: null }, '密钥已清除。'),
                },
                '清除密钥',
              )
            : null,
          message !== null ? h('p', { className: 'ocg-note' }, message) : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'opencode-go-usage', order: 20 },
            GoUsagePills,
          ),
        );
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'opencode-go-usage', order: 30, label: 'OpenCode Go' },
            GoUsageSettings,
          ),
        );
      },
    };
  },
});
