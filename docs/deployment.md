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

每次部署将代码包以 revision 和 SHA-256 为对象名保留在 `releases/feishu/`，并生成私有部署回执。生产域名与 HTTP 触发器指向 `prod` 别名。部署仅更新 LATEST；测试并提交后，单独执行版本发布与别名切换。常规回滚直接把别名切回已知版本，避免重新构建；环境密钥必须与现存加密状态匹配。

HTTPS 证书续期后，通过 `domain` 更新证书并核对真实握手。证书申请与本机定时续期不是同一件事；没有配置持续执行的续期机制时，必须记录有效期和维护责任，不能声称自动续期完成。

## v0.3 工具与日志更新

日常入口仍为 `/feishu/mcp`；`/feishu/mcp/all` 和其他分组都走现有 `/feishu/*` 路由，不改 Companion。分组的 OAuth resource metadata 使用 401 challenge 中的 `/feishu/.well-known/oauth-protected-resource/mcp/<profile>`，无需变更共享域名的 well-known 路由。

私有部署配置可增加 `logConfig`，由同一部署脚本传给 FC：

```json
{
  "logConfig": {
    "project": "your-sls-project",
    "logstore": "feishu-mcp",
    "enableRequestMetrics": true,
    "enableInstanceMetrics": true
  }
}
```

需先创建同地域 SLS project/logstore，并确认现有 FC 角色具有写日志权限。本次使用示例地域 SLS，7 天保留期、1 个 shard；日志存储会产生正常云资源费用。日志字段白名单与隐私边界见 `chatgpt-compatibility.md`。没有配置 logConfig 的自托管部署仍可从标准输出读取日志。

Markdown 转换额外要求用户权限 `docx:document.block:convert`，将其加入飞书应用和 FEISHU_SCOPES 后重新连接；只更新服务端 scope 不会扩大旧访问令牌的权限。

## 生产可观测性和版本操作

`deploy/fc-ops.py` 是这两个 MCP 的共享云配置入口，明确限定示例地域地域、`your-log-project` 和 `mcp.example.com`。自托管用户应修改这些资源常量，不能直接对自己的账号运行本生产配置。代码部署仍归各自项目。

```sh
python3 deploy/fc-ops.py configure
python3 deploy/fc-ops.py snapshot --function feishu-mcp --snapshot-dir /private/path/fc-backups
./deploy/deploy.sh deploy /private/path/deploy.json
python3 deploy/fc-ops.py release --function feishu-mcp --revision <committed-revision>
python3 deploy/fc-ops.py alarms
# 回滚示例，版本号取发布记录：
python3 deploy/fc-ops.py rollback --function feishu-mcp --version <previous-version>
```

snapshot 保存 0600 私有配置并发布回滚版本；不得提交备份。release 发布不可变版本，只切换目标函数的域名路由与触发器，保留另一函数路由和 TLS 配置。检查公网 health 的 revision；切换或健康失败时恢复之前路由与别名。发布成功后必须进行真实 MCP 只读调用；失败时用 rollback 回到先前版本。不要把版本发布自动重试当成幂等操作，响应丢失后先查询版本和别名。

两个 Logstore 使用 7 天保留期、1 个 shard。message、requestId、durationMs、statusCode 等开启字段分析；既有历史日志不会自动补建字段索引。工具日志白名单为 event、operation、outcome、request_id、duration_ms，Companion 也识别 HTTP 200 内的 isError。HTTP 日志不记录 URL 查询、正文或 Authorization。FC 自带请求指标仍有平台定义的请求字段。

在各自 Logstore 执行以下 SQL，统计工具调用和失败：

```sql
* | SELECT json_extract_scalar(message, '$.operation') AS tool,
           json_extract_scalar(message, '$.outcome') AS outcome,
           count(*) AS calls,
           avg(cast(json_extract_scalar(message, '$.duration_ms') AS double)) AS avg_ms
    WHERE json_extract_scalar(message, '$.event') = 'mcp_tool'
    GROUP BY tool, outcome
```

每函数 6 条云监控规则：函数错误、平台错误、并发限流、资源限流每分钟 >=1；HTTP 5xx 每分钟 >=3；最大耗时飞书 >=55 秒、Companion >=110 秒。统计周期 60 秒、静默 1 小时，空闲无数据视为正常，复用“云账号报警联系人”。函数超时由函数错误告警覆盖，耗时规则作提前提示。HTTP 200 的业务失败可在上述 SQL 中查到，尚不等同于云监控函数错误。告警配置回读成功不代表已验证邮件或短信投递。

健康检查为 `/feishu/healthz`，每 3 秒一次、超时 2 秒、连续失败 3 次。它仅检查进程，不访问飞书或 OSS。预留实例、链路追踪、实例并发、VPC、NAS、会话亲和不在本次修改范围。
