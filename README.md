# dsh-plugin-opencode-go-quota

在 **DeepSeek Harness (DSH)** 的 Web UI 里显示 **OpenCode Go** 的三个额度：**5 小时滚动 / 本周 / 本月**。

三个额度是三个小胶囊（pill），就排在输入框下方那一排，和 DSH 自带的「N 轮 M 步 · 缓存命中 · 上下文」并排 —— 平时是同样的灰色，不会多占一行。

```
🕐 5小时 6%    📅 本周 21%    💳 本月 18%
```

## 功能

- **三个 pill，宿主原生样式**：字号、行高、圆角、图标尺寸、hover 底色全部对齐宿主自带的统计胶囊。
- **用量越高越显眼**：默认灰（`label-tertiary`）；≥70% 变黄，≥90% 变红。
- **点击看详情**：任一 pill 打开浮层，显示三条进度条、百分比、各自的重置时间与数据更新时间；点外部或按 `Esc` 关闭。
- **设置里可控**：`设置 → OpenCode Go` 提供「显示额度」开关，以及你自己 API key 的填写/清除。
- **密钥归你管**：只使用你在设置里填入的 key，存在 DSH 凭证库里（键名 `OPENCODE_GO_API_KEY`），**不写入设置文件、不读取其他提供方的密钥**；密钥只在 Host 进程中使用，页面只拿到脱敏提示（如 `oc_sk_…D4K`）。
- **未配置就不打扰**：没填 key 或关掉开关时，输入框下方不显示任何东西。

## 前置条件

- DeepSeek Harness（桌面版，或 `dsh web`）。
- 一个 **OpenCode Go / Go Plus** 订阅的 API key（`oc_sk_…`）：在 <https://opencode.ai/auth> 的 OpenCode 控制台获取。

## 安装

把本仓库克隆到本地任意目录，然后在 DSH 里安装这个本地 bundle：

```
plugin_manager  action: install_bundle
                target: <本仓库的绝对路径>
```

或在界面上：**设置 → 插件 → 安装本地 bundle**，选中本目录。

安装后刷新页面（`Ctrl+R`）。

## 配置

1. 打开 **设置 → OpenCode Go**（在「智能体预设」下面）。
2. 在 **API Key** 里粘贴你的 `oc_sk_…`，点 **保存**。
3. 三个 pill 会立刻出现在输入框下方。

| 控件 | 说明 |
|---|---|
| 显示额度 | 关掉后输入框下方完全不显示 |
| API Key | 密码框；留空表示保持当前密钥不变 |
| 保存 / 清除密钥 | 保存后立即刷新一次额度；清除则回到「未配置」 |

## 工作原理

```
OpenCode 网关  https://opencode.ai/zen/go/v1/usage
      ▲  Authorization: Bearer <your key>
      │
Host 半边 (index.js)  ──  credentials.resolve(OPENCODE_GO_API_KEY)
      │                 30s 缓存 + 归一化三个窗口
      │  GET  /opencode-go/state          （DSH cookie 鉴权，同源）
      │  POST /opencode-go/settings
      ▼
浏览器半边 (client.js)  ──  只负责渲染
      ├─ conversation.composer.dock  三个 pill
      └─ settings.section           设置页
```

- Host 半边用 DSH 的 `webServer` 注册两条路由，并用 `connection.requestRejection` 做与内置插件同一套的 Host/Origin + cookie 校验。
- 浏览器半边不接触密钥，只读取 `state`（含脱敏提示）。
- 样式仅依赖 `--dsw-alias-*` 主题 token，自动跟随明暗主题。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 插件清单：`dsh.bundle.patch` + `dsh.client` 声明 |
| `cordis.patch.yml` | bundle 的 loader patch，插入一行插件条目 |
| `index.js` | Host 半边：凭证、网关请求、`/opencode-go/state` 与 `/opencode-go/settings` 路由 |
| `client.js` | 浏览器半边：三个 pill + 设置页 |
| `icon.svg` | 插件卡片图标 |

## 卸载

```
plugin_manager  action: remove_bundle
                target: @local/opencode-go-quota
```

凭证库里的 `OPENCODE_GO_API_KEY`（密钥）与 `OPENCODE_GO_USAGE_ENABLED`（开关）不会被自动删除；需要时在设置页点「清除密钥」，或直接删掉 `.credentials.yaml` 中对应的 `refs` 条目。

## 已知限制

- **改 Host 半边（`index.js`）后需要重启 DSH 才会生效**：DSH 按文件路径缓存已加载的 Host 模块，禁用/重新启用同一个包不会重载代码。只改浏览器半边（`client.js`）刷新页面即可。
- 只覆盖 OpenCode **Go / Go Plus** 订阅的三个额度窗口；Zen 余额不在这个接口里。
- 网关接口 `GET /zen/go/v1/usage` 是 OpenCode 面向 Go 订阅提供的接口，若上游调整路径或结构，本插件需要同步更新。

## License

MIT
