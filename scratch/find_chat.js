const fs = require('fs');

const dataDir = '/Users/aurelhullenhagen/Development/BrainExtender/data';
const chats = JSON.parse(fs.readFileSync(`${dataDir}/chats.json`, 'utf8'));

chats.chats.forEach(c => {
  if (c.title.includes('Beziehungs-Coach')) {
    console.log(`Chat: ${c.title}, Messages: ${c.messages.length}`);
  }
});
