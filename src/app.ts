import express from 'express';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { OAuth, page } from './oauth.js';
import { Feishu } from './feishu.js';
import { makeServer, catalog } from './tools.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
export function createApp(config:Config,store:Store,feishu = new Feishu(config,store)) {
  const app=express(),oauth=new OAuth(config,store,feishu);
  app.disable('x-powered-by');
  // Browsers apply form-action to every redirect in the upstream login chain.
  const loginDomain = config.feishuDomain.endsWith('.feishu.cn') ? 'feishu.cn' : 'larksuite.com';
  const formOrigins = ['open','accounts','passport','login'].map(host=>`https://${host}.${loginDomain}`).join(' ');
  app.use((_req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formOrigins}; frame-ancestors 'none'`});next();});
  app.use(express.json({limit:'2mb'}));app.use(express.urlencoded({extended:false,limit:'16kb'}));
  oauth.install(app);
  app.get('/',(_req,res)=>res.type('html').send(page('Feishu MCP MCP',`<p>分别添加连接并授权，即可在 ChatGPT 中使用对应服务。</p><h2>飞书</h2><p><a href="${config.basePath}">连接说明</a> · <code>${config.resource}</code></p><h2>Companion</h2><p><code>${config.origin}/companion/mcp</code></p>`)));
  app.get(config.basePath+'/healthz',(_req,res)=>res.json({status:'ok',service:'feishu-mcp',version:'0.1.0',revision:process.env.REVISION||'development',catalog_size:catalog.length}));
  app.get([config.basePath,config.basePath+'/'],(_req,res)=>res.type('html').send(page('Feishu MCP 飞书 MCP',`<p>在 ChatGPT 中添加 OAuth 连接：</p><p><code>${config.resource}</code></p><p>支持多维表格、文档、知识库、任务等飞书工具。通过飞书登录后，按所授予权限访问自己的资料。</p>`)));
  app.all(config.basePath+'/mcp',async(req,res,next)=>{
    try {
      if(req.headers.origin && req.headers.origin!==config.origin){res.status(403).json({error:'untrusted_origin'});return;}
      const grant=await oauth.authenticate(req);
      if(!grant){res.set('WWW-Authenticate',oauth.challengeHeader()).status(401).json({error:'unauthorized'});return;}
      if(req.method!=='POST'){res.set('Allow','POST').status(405).end();return;}
      const server=makeServer(config,()=>feishu.userToken(grant.sessionId));
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      res.on('close',()=>{void transport.close();void server.close();});
      await server.connect(transport);await transport.handleRequest(req,res,req.body);
    } catch(e){next(e);}
  });
  app.use((_req,res)=>res.status(404).json({error:'not_found'}));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    // Never log Axios request config, OAuth bodies, cookies, or credentials.
    console.error(JSON.stringify({event:'request_failed',type:(error as Error).name}));
    if(!res.headersSent)res.status(500).json({error:'internal_error'});
  });
  return app;
}
