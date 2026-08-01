const fs = require('fs');

const dataDir = '/Users/aurelhullenhagen/Development/BrainExtender/data';
const chats = JSON.parse(fs.readFileSync(`${dataDir}/chats.json`, 'utf8'));

const activeChat = chats.chats.find(c => c.title.includes('Beziehungs-Coach'));
if (activeChat) {
  const lastMessages = activeChat.messages.slice(-5);
  console.log("Last 5 messages:");
  lastMessages.forEach(m => console.log(`[${m.role}] ${m.content.substring(0, 100)}`));
} else {
  console.log("Chat not found");
}
