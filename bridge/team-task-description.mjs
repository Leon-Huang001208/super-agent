const currentRules='\nRead your instructions_file and available project rules: AGENTS.md when provided, otherwise existing project documentation and shared engineering guidance. A missing optional AGENTS.md filename alone does not block readonly validation; project-declared required rules remain required. Record material SHA and actual verification. Keep existing artifacts. Follow the current Native project delivery policy and owner authorization.';
const previousProjectRules='\nRead your instructions_file and current project AGENTS.md. Record material SHA and actual verification. Keep existing artifacts. Follow the current Native project delivery policy and owner authorization.';
const previousLegacyRules='\nRead your instructions_file and record material SHA. Keep existing artifacts; no RWB merge/deploy, installation or host configuration change.';
const describe=(entry,rules)=>entry.goal+'\n\nRequired deliverable: '+entry.outputFile+rules;
export const renderTeamTaskDescription=entry=>describe(entry,currentRules);
export function teamTaskDescriptionForIntent(entry,intent){
 if(Object.hasOwn(entry,'renderedDescription')){
  if(typeof entry.renderedDescription!=='string'||!entry.renderedDescription)throw Object.assign(Error('TEAM_DISPATCH_DESCRIPTION_INVALID'),{code:'TEAM_DISPATCH_DESCRIPTION_INVALID'});
  return entry.renderedDescription;
 }
 return describe(entry,intent.projectId?previousProjectRules:previousLegacyRules);
}
