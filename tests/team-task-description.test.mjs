import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTeamTaskDescription,teamTaskDescriptionForIntent} from '../bridge/team-task-description.mjs';

const entry={goal:'Validate existing contracts only.',outputFile:'backend.md'};
const prefix=entry.goal+'\n\nRequired deliverable: '+entry.outputFile;
const oldProject=prefix+'\nRead your instructions_file and current project AGENTS.md. Record material SHA and actual verification. Keep existing artifacts. Follow the current Native project delivery policy and owner authorization.';
const oldLegacy=prefix+'\nRead your instructions_file and record material SHA. Keep existing artifacts; no RWB merge/deploy, installation or host configuration change.';

test('new child descriptions clarify available rules and retain their exact intent snapshot',()=>{
 const text=renderTeamTaskDescription(entry),saved={...entry,renderedDescription:text};
 assert.match(text,/AGENTS\.md when provided/);assert.match(text,/missing optional AGENTS\.md filename alone does not block readonly validation/);assert.match(text,/project-declared required rules remain required/);
 assert.equal(teamTaskDescriptionForIntent(saved,{projectId:'project'}),text);
 assert.equal(teamTaskDescriptionForIntent({...saved,goal:'changed renderer input'},{projectId:'project'}),text);
});
test('pre-existing generic and legacy intents replay the exact original child description',()=>{
 const child={description:oldProject},before=structuredClone(child);
 assert.notEqual(renderTeamTaskDescription(entry),child.description);
 assert.equal(teamTaskDescriptionForIntent(entry,{projectId:'project'}),child.description);
 assert.equal(teamTaskDescriptionForIntent(entry,{}),oldLegacy);
 assert.deepEqual(child,before);
});
test('a malformed explicit description snapshot is rejected instead of re-rendered',()=>{
 for(const renderedDescription of [null,'',1])assert.throws(()=>teamTaskDescriptionForIntent({...entry,renderedDescription},{projectId:'project'}),/TEAM_DISPATCH_DESCRIPTION_INVALID/);
});
