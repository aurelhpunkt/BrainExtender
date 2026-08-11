const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const chatsPath = path.join(dataDir, 'chats.json');
const chatsData = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));

const activeChat = chatsData.chats.find(c => c.title.includes('Beziehungs-Coach'));
if (!activeChat) {
  console.error("Chat not found.");
  return;
}

const allMessages = activeChat.messages;
console.log(`Total Messages: ${allMessages.length}`);
if (allMessages.length > 0) {
  console.log(`First Message Timestamp: ${allMessages[0].timestamp}`);
  console.log(`Last Message Timestamp: ${allMessages[allMessages.length - 1].timestamp}`);
}
