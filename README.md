# Feishu MCP Serverless

将飞书官方 OpenAPI MCP 的工具部署到阿里云函数计算，让 ChatGPT 等远程 MCP 客户端通过 OAuth 操作飞书资料。

独立 MIT 项目，复用 `@larksuiteoapi/lark-mcp@0.5.1` 的工具、参数结构和调用实现。这里负责 HTTP 服务、云端授权、持久化及部署。来源与原许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 功能

- 无状态 Streamable HTTP，默认 `/feishu/mcp`，支持 FC 缩容到零。
- 飞书用户登录；MCP 客户端使用独立的授权码、访问令牌和刷新令牌。飞书令牌不会交给 MCP 客户端。
- OAuth discovery、DCR、PKCE S256、resource 校验、显式授权页、浏览器状态绑定、一次性授权码、刷新令牌轮换和撤销。
- 私有 OSS 加密存储授权状态，跨实例的一次性操作用 OSS 原子禁止覆盖实现。
- 常用多维表格操作直接显示；`feishu_search_tools` 搜索其他工具的名称、说明和完整参数，`feishu_call_tool` 执行。
- 用户身份可用的上游工具均保留在可搜索目录，具体操作仍受飞书应用权限、用户授权和资源权限约束。

**工具目录存在不代表每个 API 都已真实验收。** 官方上游标注的二进制上传下载接口不在当前调用目录中；个人账单的文件导入可先解析导出文件，再调用多维表格记录工具。不能自动访问银行或支付平台账单。

## 本地运行

需要 Node.js 22+。

```sh
npm ci
cp .env.example .env
# 填入自己的飞书应用配置。Node 负责载入环境文件。
node --env-file=.env --import tsx src/index.ts
```

```sh
npm run verify
```

`.npmrc` 禁止依赖安装脚本：上游含桌面 keytar，但本项目按模块导入工具，不使用桌面认证与钥匙串。构建产物不需要该原生模块。

## 飞书应用

1. 在自己的企业创建应用，配置所需 API 的用户权限。可参考已验证的 [权限清单](docs/feishu-permissions.json)，包含持续访问所需的 `offline_access`。
2. 添加精确回调 `https://你的域名/feishu/callback`。
3. 发布应用，设置合适的可用范围。
4. 将应用 ID、Secret 配置到部署环境。不要提交密钥或真实账单。
5. `FEISHU_SCOPES` 包含 `offline_access` 和需要授权的 API scopes；应用未开通的 scope 不会因这里配置而生效。

通过用户身份执行，不能借此获得用户本来没有的数据权限。变更权限后应重新连接授权。多维表格的单条读取使用 `base:record:read`，按条件查询和列出记录还需要 `base:record:retrieve`，两者都应开通并在 OAuth 中请求。

## FC 部署

详见 [部署说明](docs/deployment.md)。部署入口：

```sh
sh deploy/deploy.sh preflight /absolute/path/to/private-deploy.json
sh deploy/deploy.sh deploy /absolute/path/to/private-deploy.json
sh deploy/deploy.sh domain /absolute/path/to/private-deploy.json
```

项目和密钥配置分离；公网服务不依赖开发者电脑。Docker 运行可使用 [Dockerfile](Dockerfile)。

## ChatGPT 连接

在支持自定义 MCP 的 ChatGPT 设置中添加 MCP URL，选择 OAuth。当前部署的连接名称建议为 **Feishu MCP 飞书**。复制 ChatGPT 界面显示的精确回调地址到 `OAUTH_REDIRECT_URIS`；服务支持 issuer identification，默认包含稳定回调。

具体账户是否开放自定义连接，以 ChatGPT 界面为准。[OpenAI 官方连接说明](https://developers.openai.com/plugins/deploy/connect-chatgpt) · [授权说明](https://developers.openai.com/plugins/build/auth)。

## 个人账单示例

见 [个人账单表设计](docs/personal-bills.md)。这是通用飞书 MCP 的使用示例，项目并不限于账单。

## 验收

已完成 ChatGPT 网页授权及多维表格真实读写；详见 [验收记录](docs/verification.md)。

## 当前边界

- OAuth 登录会话最长 30 天，过期需重新连接；飞书刷新令牌提前失效也需重新授权。
- 上游令牌轮换发生网络结果不明或进程退出时，要求重新授权，避免并发重复刷新。
- OSS 桶禁止启用或暂停版本控制；不要对客户端注册对象配置短期生命周期删除。
- 上游依赖包含 npm audit 报告的 PAC 代理解析依赖问题。当前 OSS 请求使用固定 endpoint、未启用 PAC，仍需随上游升级跟进；不声称依赖审计零问题。

## 参考

- [飞书官方源码](https://github.com/larksuite/lark-openapi-mcp)
- [FC 自定义域名路由](https://help.aliyun.com/zh/functioncompute/configure-custom-domain-names)
- [OSS 原子禁止覆盖](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)
