import { Client } from '@larksuiteoapi/node-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AllToolsZh } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/tools/index.js';
import { larkOapiHandler } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/handler.js';
import type { McpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/types/index.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios from 'axios';
import type { Config } from './config.js';

// Keep all upstream tools that can operate as the signed-in user. Unsupported
// binary transfer endpoints are excluded; their transport needs separate work.
export const catalog: McpTool[] = (AllToolsZh as McpTool[]).filter(t=>t.accessTokens?.includes('user') && !t.supportFileUpload && !t.supportFileDownload);
const byName = new Map(catalog.map(t=>[t.name,t]));
const textResult = (data: unknown, isError = false) => ({ content: [{type:'text' as const,text:JSON.stringify(data)}], ...(isError?{isError}: {}) });
export function makeServer(config: Config, userToken: ()=>Promise<string>) {
  const server = new McpServer({name:'Feishu MCP Feishu',version:'0.1.0'},{instructions:'操作飞书资料。先使用 feishu_search_tools 查找准确工具名与参数，再调用 feishu_call_tool。多维表格使用 bitable 工具。写入后读取验证；删除、发送消息等需有明确用户指令。分页结果需继续读取 next_page_token/page_token。'});
  const http = axios.create({timeout:25000});
  http.interceptors.response.use(response=>{
    // HTTP 200 can still be a Feishu API failure. Preserve it as an MCP error.
    if (response.data?.code && response.data.code!==0) {
      const error = new Error('Feishu API error') as Error & {response:unknown};error.response=response;throw error;
    }
    return response.data;
  });
  const client = new Client({appId:config.appId,appSecret:config.appSecret,domain:config.feishuDomain,httpInstance:http as unknown as NonNullable<ConstructorParameters<typeof Client>[0]['httpInstance']>,
    logger:{error(){},warn(){},info(){},debug(){},trace(){}}});
  const invoke=async(tool:McpTool,params:unknown)=>{
    const parsed=z.object(tool.schema).safeParse(params);
    if(!parsed.success)return textResult({error:'invalid_arguments',details:parsed.error.issues},true);
    try {
      const token=await userToken();
      const result=await (tool.customHandler || larkOapiHandler)(client,{...parsed.data,useUAT:true},{userAccessToken:token,tool});
      return result;
    } catch {return textResult({error:'reauthorization_required',message:'请重新连接飞书授权，或稍后重试。'},true);}
  };
  const security = {securitySchemes:[{type:'oauth2',scopes:['feishu']}]};
  server.registerTool('feishu_search_tools',{
    title:'搜索飞书工具',description:'搜索全部可用飞书工具，返回官方工具名称、用途和完整参数结构。关键词可用中文或 API 名，如 多维表格、记录、文档、日历、任务、bitable、appTableRecord。查询结果支持 offset 分页。',
    inputSchema:{query:z.string().max(200),project:z.string().optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(20).default(5)},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},_meta:security
  },async({query,project,offset,limit})=>{
    const words=query.toLowerCase().split(/\s+/).filter(Boolean);
    const found=catalog.filter(t=>(!project || t.project===project) && words.every(w=>(t.name+' '+t.description).toLowerCase().includes(w)));
    return textResult({total:found.length,next_offset:offset+limit<found.length?offset+limit:null,tools:found.slice(offset,offset+limit).map(t=>({name:t.name,description:t.description,inputSchema:zodToJsonSchema(z.object(t.schema),{$refStrategy:'none'})}))});
  });
  server.registerTool('feishu_call_tool',{
    title:'调用飞书工具',description:'按 feishu_search_tools 返回的官方工具名及参数执行操作。可读写多维表格、文档、知识库、任务、日历等。必须先检索该工具的参数定义；操作始终使用当前授权用户身份。发送消息、删除、权限修改应有明确用户指令。',
    inputSchema:{name:z.string().max(180),arguments:z.record(z.unknown())},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},_meta:security
  },async({name,arguments:args})=>{
    const tool=byName.get(name);return tool?invoke(tool,args):textResult({error:'unknown_tool',message:'请先通过 feishu_search_tools 查找工具。'},true);
  });
  // Common Bitable operations also have direct, fully typed tools for everyday use.
  const direct = ['bitable.v1.app.create','bitable.v1.app.get','bitable.v1.appTable.list','bitable.v1.appTable.create',
    'bitable.v1.appTableField.list','bitable.v1.appTableField.create','bitable.v1.appTableRecord.search',
    'bitable.v1.appTableRecord.batchCreate','bitable.v1.appTableRecord.batchUpdate','bitable.v1.appTableRecord.get'];
  for(const name of direct){const tool=byName.get(name);if(!tool)continue;
    server.registerTool('feishu_'+name.replace(/\./g,'_'),{description:'飞书：'+tool.description,inputSchema:tool.schema,
      annotations:{readOnlyHint:tool.httpMethod?.toUpperCase()==='GET'||name.endsWith('.search'),destructiveHint:false,openWorldHint:true},_meta:security},(args:unknown)=>invoke(tool,args));
  }
  return server;
}
