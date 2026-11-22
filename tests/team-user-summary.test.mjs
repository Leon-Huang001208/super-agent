import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUserSummary,teamResultStage,userSummaryInstructions} from '../bridge/team-user-summary.mjs';

const value={completed:'已整理两份文档。',pending:'草稿尚未合入源码。',next:'由负责人沿原任务整合成稿。'};
const block=value=>'<!-- user-notification:v1\n'+JSON.stringify(value)+'\n-->';
const root='12345678-1234-4234-8234-123456789012';

test('a separate short block is read while the original technical report stays intact',()=>{
 const text='# 技术报告\n| Root | SHA |\n| '+root+' | '+'a'.repeat(64)+' |\nNOT_RUN: deploy\n'+block(value);
 const before=text;assert.deepEqual(parseUserSummary(text),value);assert.equal(text,before);
});

test('business numbers and URLs are retained and Unicode text has a 240-character limit',()=>{
 const entry={completed:'净值1.2345，截至2026-11-22，达标率99.5%。',pending:'待核对 https://example.org/'+root+'?source='+'b'.repeat(64),next:'  由负责人查看 https://example.org/topic/12345678901234567890 后继续。  '};
 assert.deepEqual(parseUserSummary(block(entry)),{...entry,next:entry.next.trim()});
 assert.equal(parseUserSummary(block({...value,completed:'🧭'.repeat(240)})).completed,'🧭'.repeat(240));
 assert.equal(parseUserSummary(block({...value,completed:'🧭'.repeat(241)})),null);
});

test('missing, malformed, unsupported or repeated blocks fall back without throwing',()=>{
 for(const text of [undefined,'技术总结',block(value)+block(value),'<!-- user-notification:v1\nnot-json\n-->',block(value).replace(':v1',':v2')])assert.equal(parseUserSummary(text),null);
});

test('only the three own nonempty string fields are accepted, including prototype-field rejection',()=>{
 for(const entry of [{},[],{...value,stage:'deployed'},{...value,budget:20},{...value,next:null},{...value,pending:' '}])assert.equal(parseUserSummary(block(entry)),null);
 assert.equal(parseUserSummary('<!-- user-notification:v1\n{"completed":"完成","pending":"待办","next":"继续","__proto__":{"polluted":true}}\n-->'),null);
 assert.equal({}.polluted,undefined);
});

test('short fields reject control characters, Markdown, commands and bare technical identifiers',()=>{
 for(const next of ['第一行\n第二行','| 字段 | 结果 |','`git status`','- 清单','请执行 git push origin main','Root '+root,'SHA '+ 'c'.repeat(64),'提交 '+ 'd'.repeat(40),'NOT_RUN: release'])assert.equal(parseUserSummary(block({...value,next})),null,next);
});

const flow=(roles=['document-specialist','qa'])=>({taskEntries:roles.map((role,i)=>({key:'step-'+i,role})),artifacts:Object.fromEntries(roles.map((role,i)=>['step-'+i,{verdict:role==='qa'?'PASS':undefined}]))});

test('actual nonempty QA PASS yields document or generic artifact review, never deployment',()=>{
 const docs=flow(),before=structuredClone(docs);assert.equal(teamResultStage(docs),'documents-reviewed');assert.deepEqual(docs,before);
 assert.equal(teamResultStage(flow(['backend-engineer','qa'])),'artifacts-reviewed');
 docs.summary={deployed:true,published:true};assert.equal(teamResultStage(docs),'documents-reviewed');
});

test('no QA, missing QA output or NEEDS_WORK cannot be displayed as QA passed',()=>{
 assert.equal(teamResultStage({taskEntries:[],artifacts:{}}),'results-collected');assert.equal(teamResultStage(flow(['document-specialist'])),'results-collected');
 const missing=flow();delete missing.artifacts['step-1'];assert.equal(teamResultStage(missing),'results-collected');
 const failed=flow();failed.artifacts['step-1'].verdict='NEEDS_WORK';assert.equal(teamResultStage(failed),'results-collected');
});

test('instructions request one versioned block in the same report with evidence-bound claims',()=>{
 const text=userSummaryInstructions();assert.match(text,/user-notification:v1/);assert.match(text,/completed/);assert.match(text,/pending/);assert.match(text,/next/);
 assert.match(text,/240/);assert.match(text,/原.*文件/);assert.match(text,/实际.*回执/);assert.match(text,/合并/);assert.match(text,/部署/);
 assert.match(text,/文档.*不.*源码/);assert.match(text,/阶段.*系统|系统.*阶段/);
});
