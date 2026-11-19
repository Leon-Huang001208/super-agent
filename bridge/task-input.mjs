import{createHash}from'node:crypto';
export const taskInputRevision=task=>createHash('sha256').update(JSON.stringify({title:task.title??'',description:task.description??''})).digest('hex');
