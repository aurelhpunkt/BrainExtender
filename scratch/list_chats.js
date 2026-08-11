const fs = require('fs');
const path = require('path');

const chatsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chats.json'), 'utf8'));

chatsData.chats.forEach(c => {
  console.log(`Title: "${c.title}", Messages: ${c.messages.length}`);
});
