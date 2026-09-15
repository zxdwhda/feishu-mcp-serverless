# FC 部署与回滚

## 拓扑

一个 FC 自定义域名按路径连接两个独立函数。本项目管理飞书函数；Companion 有自己的项目和发布过程。

| 路径 | 函数 |
| --- | --- |
| `/feishu/*` | `feishu-mcp` |
| `/.well-known/oauth-authorization-server/feishu` | `feishu-mcp` |
| `/.well-known/oauth-protected-resource/feishu/mcp` | `feishu-mcp` |
| `/companion/*` | `companion-mcp` |
| `/.well-known/oauth-authorization-server/companion` | `companion-mcp` |
| `/.well-known/oauth-protected-resource/companion/mcp` | `companion-mcp` |

根路径可指向飞书函数的连接说明页。不要将整个 `/.well-known/*` 兜底交给同一个服务；两个 issuer 和资源标识不同。

## 运行配置

- FC 示例地域 `your-region`，`custom.debian11`。
- 代码包包含 Linux x64 Node 22 二进制和独立 JS bundle，启动 `/code/node /code/server.cjs`。
- 端口 9000、0.5 CPU、1024 MB、实例并发 10、请求超时 60 秒，无预留实例。运行时配置与应用 PORT 必须一致。
- 飞书是无状态 MCP，不需要 MCP 会话亲和；GET/DELETE 返回 405 是预期行为。
- 私有 OSS 同地域；配置角色以访问 OSS，禁止把本机账号永久 AccessKey 写入函数环境变量。`disableInjectCredentials=Request` 保留 FC 环境变量凭据注入。

## 私有部署配置

复制 `deploy/config.example.json`，密钥配置放 Git 目录外或被忽略且权限 0600 的 `.local/`。同时准备 Node 官方二进制并核对官方 SHASUMS256，填入 nodeBinary 的绝对路径。

部署脚本读取现有 Aliyun CLI profile，默认使用 current，可用 `ALIYUN_PROFILE` 指定。源码应先通过 `npm run verify` 并提交；preflight 核对工作区、OSS ACL/版本配置。部署入口会先从当前提交重新构建，避免打包旧 dist。发布包只包含三个构建文件和 node，不打包 `.env`、`.local`、OAuth 状态和个人资料。

`domain` 合并配置中列出的路径，保留其他路径，但会更新共享域名证书。应由域名维护任务统一执行，避免同时修改。DNS CNAME 指向 `<account-id>.your-region.fc.aliyuncs.com`。

## 状态存储

同一私有桶使用 `feishu/`、`companion/` 独立前缀及独立加密密钥。AES-256-GCM 加密，完整对象名为 AAD。应用检查每条记录的过期时间。

授权码、回调、刷新轮换的单次消费通过创建 `claims/` 下不可覆盖的对象实现，避免两个 FC 实例同时成功兑换。存储桶不能启用版本控制，否则 OSS 的 forbid-overwrite 条件会失效。暂不自动删除过期对象；未来清理应按记录类型设置，并保留仍有效的 DCR clients。

## 验收

1. 公网 HTTPS 证书与域名匹配，两个服务的 health 分别返回对应身份。
2. 未授权 MCP 请求返回 401，WWW-Authenticate 指向该服务的资源元数据。
3. 从 ChatGPT 完成授权并读取工具列表。
4. 创建独立测试多维表格，创建/查询/更新记录，验证返回值及错误路径。
5. 同一授权令牌连续调用和并发调用；令牌过期、错误 resource、重复兑换和撤销应被拒绝。

健康成功、OAuth 测试成功、ChatGPT 连接成功与业务读写成功应分别记录，不能互相替代。

## 回滚与证书续期

每次部署将代码包以 revision 和 SHA-256 为对象名保留在 `releases/feishu/`，并生成私有部署回执。回滚时检出已验证提交，恢复对应的私有环境配置，通过同一个部署入口发布；环境密钥必须与现存加密状态匹配。

HTTPS 证书续期后，通过 `domain` 更新证书并核对真实握手。证书申请与本机定时续期不是同一件事；没有配置持续执行的续期机制时，必须记录有效期和维护责任，不能声称自动续期完成。
