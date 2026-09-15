import { createHash } from 'node:crypto';
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
export function exposedName(name: string) {
  const full = 'feishu_' + name.replace(/\./g,'_');
  return full.length <= 64 ? full : full.slice(0,53) + '_' + createHash('sha256').update(name).digest('hex').slice(0,10);
}
const byName = new Map(catalog.map(t=>[t.name,t]));
const textResult = (data: unknown, isError = false) => ({ content: [{type:'text' as const,text:JSON.stringify(data)}], ...(isError?{isError}: {}) });
export function makeServer(config: Config, userToken: ()=>Promise<string>) {
  const server = new McpServer({name:'Feishu MCP Feishu',version:'0.2.0'},{instructions:'操作当前授权用户的飞书资料。搜索文件使用 feishu_docx_builtin_search，搜索知识库使用 feishu_wiki_v1_node_search；feishu_search_tools 仅搜索工具说明，不搜索实际文件。全部用户工具已直接提供，优先直接调用。多维表格使用 bitable 工具。写入后读取验证；删除、发消息及权限修改需有用户指令。分页按各接口的 has_more、page_token 或 offset 继续。'});
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
  // Expose the whole supported catalog so clients can discover and invoke each
  // operation directly, including file search, rather than only Bitable shortcuts.
  for(const tool of catalog){
    const readOnly = tool.httpMethod?.toUpperCase()==='GET' || /\.(search|get|list|batchGet|query|read)$/.test(tool.name);
    const {useUAT: _useUAT, ...schema} = tool.schema;
    const descriptions:Record<string,string> = {
      'docx.builtin.search':'搜索当前用户有权访问的飞书云文档。用于按记账、账单、财务等关键词查找实际文件，返回文件信息；这不是工具目录搜索。',
      'wiki.v1.node.search':'按关键词搜索当前用户有权访问的飞书知识库节点，寻找文档、表格及相关资料。'
    };
    server.registerTool(exposedName(tool.name),{description:descriptions[tool.name] || '飞书：'+tool.description,inputSchema:schema,
      annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:true},_meta:security},(args:unknown)=>invoke(tool,args));
  }
  return server;
}
