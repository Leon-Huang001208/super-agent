const fields=['completed','pending','next'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function userSummaryInstructions(){
 return '在原完整技术报告文件末尾额外写且只写一次下列独立用户摘要块，不替换、删减技术报告，也不新建摘要文件或增加模型调用。\n'+
  '<!-- user-notification:v1\n{"completed":"简述实际完成了什么","pending":"简述还未完成什么","next":"简述下一步由谁做什么"}\n-->\n'+
  '块内只允许 completed、pending、next 三个非空字符串，每项最多240个Unicode字符、单行纯文本。保留必要业务数字和普通URL，不写Markdown表格、列表、代码、命令、UUID、SHA或NOT_RUN流水。\n'+
  '当前阶段、调用量和QA结论由系统依据实际flow派生，不在此JSON中提供这些字段。只有实际合并或部署回执才能陈述合并、部署成功；文档QA通过不代表源码发布或生产部署验收。没有实际回执时明确还差什么，不猜完成百分比。';
}

function plain(value){
 if(typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))return false;
 const text=value.trim();if(!text||Array.from(text).length>240)return false;
 if(/[`|]|\*\*|__|~~|\[[^\]]*\]\s*\(|<\/?[A-Za-z][^>]*>|^(?:#{1,6}|>|[-+*]|\d+[.)])\s/u.test(text))return false;
 // Validation leaves the original URL and business text intact in the result.
 const prose=text.replace(/https?:\/\/[^\s<>"'`|，。；！？、（）【】]+/gu,'');
 if(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b|\b(?:[0-9a-f]{40}|[0-9a-f]{64})\b|\bNOT_RUN\b/i.test(prose))return false;
 return !/(?:^|[\s：:])(?:[$%]\s|(?:git|docker|node|python(?:\d+(?:\.\d+)*)?|sudo|bash|sh)\s)/i.test(prose);
}

/** Invalid or absent display metadata falls back to null; technical text is never changed. */
export function parseUserSummary(text){
 if(typeof text!=='string'||(text.match(/<!--\s*user-notification:/g)??[]).length!==1)return null;
 const block=/<!-- user-notification:v1\r?\n([\s\S]*?)\r?\n-->/.exec(text);if(!block)return null;
 let value;try{value=JSON.parse(block[1]);}catch{return null;}
 if(!object(value)||Object.keys(value).length!==fields.length||!fields.every(key=>Object.hasOwn(value,key)&&plain(value[key])))return null;
 return Object.fromEntries(fields.map(key=>[key,value[key].trim()]));
}

/** Display only: keep existing business acceptance and source/deployment decisions elsewhere. */
export function teamResultStage(flow){
 const entries=Array.isArray(flow?.taskEntries)?flow.taskEntries:[],qa=entries.filter(entry=>entry?.role==='qa');
 if(!qa.length||!object(flow?.artifacts)||!qa.every(entry=>Object.hasOwn(flow.artifacts,entry.key)&&flow.artifacts[entry.key]?.verdict==='PASS'))return'results-collected';
 const work=entries.filter(entry=>entry?.role!=='qa');
 return work.length&&work.every(entry=>entry?.role==='document-specialist')?'documents-reviewed':'artifacts-reviewed';
}
