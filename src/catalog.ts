import { createHash } from 'node:crypto';
import { AllToolsZh } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/tools/index.js';
import type { McpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/types/index.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
// Keep all upstream tools that can operate as the signed-in user. Unsupported
// binary transfer endpoints are excluded; their transport needs separate work.
export const catalog: McpTool[] = (AllToolsZh as McpTool[]).filter(t=>t.accessTokens?.includes('user') && !t.supportFileUpload && !t.supportFileDownload);
export function exposedName(name: string) {
  const full = 'feishu_' + name.replace(/\./g,'_');
  return full.length <= 64 ? full : full.slice(0,53) + '_' + createHash('sha256').update(name).digest('hex').slice(0,10);
}

export const byName = new Map(catalog.flatMap(t => [[t.name,t], [exposedName(t.name),t]]));
export const profiles = ['daily','all','docs','bitable','calendar','tasks','messages','drive','wiki'] as const;
export type ToolProfile = typeof profiles[number];
export function annotationsFor(tool: McpTool) {
  const readOnly = tool.httpMethod?.toUpperCase() === 'GET' || /\.(search|get|list|batchGet|query|read|mget|filter)$/.test(tool.name)
    || ['docx.v1.document.convert','calendar.v4.calendar.primary','baike.v1.entity.match','baike.v1.entity.highlight','lingo.v1.entity.match','lingo.v1.entity.highlight'].includes(tool.name);
  const boundedCreate = /^bitable\.v1\.(app|appTable|appTableField|appTableView|appTableRecord)\.(create|batchCreate|copy)$/.test(tool.name)
    || ['docx.v1.document.create','docx.v1.documentBlockChildren.create','docx.v1.documentBlockDescendant.create','docx.builtin.import','drive.v1.file.createFolder'].includes(tool.name);
  return { readOnlyHint:readOnly, destructiveHint:!readOnly && !boundedCreate, idempotentHint:readOnly,
    openWorldHint: !readOnly && (/^(mail|im|helpdesk)\./.test(tool.name) || /permission|Acl|collaboration|share|invite|Attendee|transferOwner/i.test(tool.name) || tool.project === 'calendar') };
}
export function nativeTools(profile: ToolProfile) {
  if (profile === 'all') return catalog;
  const groups: Record<string,string[]> = { docs:['docs','docx'], bitable:['bitable','base'], calendar:['calendar'],tasks:['task'],messages:['im','mail'],drive:['drive'],wiki:['wiki'] };
  return catalog.filter(t => groups[profile]?.includes(t.project));
}
const schemas = new Map<string, ReturnType<typeof zodToJsonSchema>>();
export function nativeSchema(tool: McpTool) {
  let schema = schemas.get(tool.name);
  if (!schema) {
    const { useUAT: _, ...shape } = tool.schema;
    schema = zodToJsonSchema(z.object(shape), { $refStrategy:'root' });
    schemas.set(tool.name, schema);
  }
  return schema;
}
