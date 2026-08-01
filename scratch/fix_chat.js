const fs = require('fs');
const path = require('path');

const dataDir = '/Users/aurelhullenhagen/Development/BrainExtender/data';
const chatsPath = path.join(dataDir, 'chats.json');
const chats = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));

let modified = false;
chats.chats.forEach(chat => {
  if (chat.title.includes('Beziehungs-Coach')) {
    // Find messages containing the problematic string
    const originalLength = chat.messages.length;
    chat.messages = chat.messages.map(m => {
      if (m.content.includes('nackten Bauch') && m.content.includes('Snapchat')) {
        m.content = m.content.replace('nackten Bauch', '[Zensiert durch System, um API Blockade zu lösen]');
        modified = true;
      }
      return m;
    });
  }
});

if (modified) {
  fs.writeFileSync(chatsPath, JSON.stringify(chats, null, 2));
  console.log("Chat history sanitized successfully.");
} else {
  console.log("No problematic messages found.");
}
