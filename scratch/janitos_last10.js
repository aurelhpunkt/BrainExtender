const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const chatsPath = path.join(dataDir, 'chats.json');
const chatsData = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));

const activeChat = chatsData.chats.find(c => c.title.includes('Janitos'));
if (!activeChat) {
  console.error("Chat not found.");
  return;
}

const lastMessages = activeChat.messages.slice(-10);
const output = lastMessages.map(m => `[${m.role.toUpperCase()}] ${m.timestamp}:\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}\n\n`);

const outPath = path.join(__dirname, 'last_10_janitos.txt');
fs.writeFileSync(outPath, output.join(''));
console.log(`Saved last 10 messages to ${outPath}`);
