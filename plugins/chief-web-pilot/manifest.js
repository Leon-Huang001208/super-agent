export default {
  id: 'super-agent.chief-web-pilot',
  apiVersion: 1,
  version: '0.1.0',
  displayName: 'Super Agent 网页续接',
  description: '在原 Chief 对话查看和控制已授权的 RWB 续接任务。',
  author: 'Super Agent',
  categories: ['ui'],
  minimumHostVersion: '2026.1023.0',
  capabilities: ['ui.detailTab.register'],
  entrypoints: { worker: './worker.js', ui: './ui' },
  ui: {
    slots: [{
      type: 'taskDetailView',
      id: 'chief-web-continuation',
      displayName: 'RWB #261',
      exportName: 'ChiefWebPilotPanel',
      entityTypes: ['issue'],
    }],
  },
};
