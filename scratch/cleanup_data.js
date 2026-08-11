const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const kgPath = path.join(dataDir, 'knowledge_graph.json');
const todosPath = path.join(dataDir, 'todos.json');
const deadlinesPath = path.join(dataDir, 'deadlines.json');
const chatsPath = path.join(dataDir, 'chats.json');

const keywords = ['Friedhelm', 'CEO-Check', 'Schwanewede', 'Samsung SSD prüfen', 'Pi Setup abschließen'];

function containsKeyword(text) {
  if (!text) return false;
  return keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
}

// 1. Cleanup Knowledge Graph
if (fs.existsSync(kgPath)) {
  const kg = JSON.parse(fs.readFileSync(kgPath, 'utf8'));
  const originalLength = kg.entities.length;
  kg.entities = kg.entities.filter(t => !containsKeyword(t.entity1) && !containsKeyword(t.entity2) && !containsKeyword(t.relation));
  fs.writeFileSync(kgPath, JSON.stringify(kg, null, 2));
  console.log(`Knowledge Graph: Removed ${originalLength - kg.entities.length} entities.`);
}

// 2. Cleanup Todos
if (fs.existsSync(todosPath)) {
  const todosData = JSON.parse(fs.readFileSync(todosPath, 'utf8'));
  const originalLength = todosData.length;
  const filteredTodos = todosData.filter(t => !containsKeyword(t.title) && !containsKeyword(t.description));
  fs.writeFileSync(todosPath, JSON.stringify(filteredTodos, null, 2));
  console.log(`Todos: Removed ${originalLength - filteredTodos.length} todos.`);
}

// 3. Cleanup Deadlines
if (fs.existsSync(deadlinesPath)) {
  const deadlinesData = JSON.parse(fs.readFileSync(deadlinesPath, 'utf8'));
  const originalLength = deadlinesData.length;
  const filteredDeadlines = deadlinesData.filter(d => !containsKeyword(d.title) && !containsKeyword(d.context));
  fs.writeFileSync(deadlinesPath, JSON.stringify(filteredDeadlines, null, 2));
  console.log(`Deadlines: Removed ${originalLength - filteredDeadlines.length} deadlines.`);
}

// 4. Cleanup Chats (Rolling Summaries and System Instructions)
if (fs.existsSync(chatsPath)) {
  const chatsData = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));
  let modifiedChats = 0;
  chatsData.chats.forEach(chat => {
    if (chat.title.includes('Janitos')) {
      let modified = false;
      if (containsKeyword(chat.rolling_summary)) {
        chat.rolling_summary = "";
        modified = true;
      }
      if (containsKeyword(chat.systemInstruction)) {
        chat.systemInstruction = "";
        modified = true;
      }
      // Optional: remove messages in Janitos chat that contain CEO-Check
      const originalMsgs = chat.messages.length;
      chat.messages = chat.messages.filter(m => !containsKeyword(m.content));
      if (originalMsgs !== chat.messages.length) {
        modified = true;
        console.log(`Janitos Chat: Removed ${originalMsgs - chat.messages.length} polluted messages.`);
      }
      
      if (modified) modifiedChats++;
    }
  });
  
  if (modifiedChats > 0) {
    fs.writeFileSync(chatsPath, JSON.stringify(chatsData, null, 2));
    console.log(`Chats: Cleaned up ${modifiedChats} chat(s).`);
  } else {
    console.log(`Chats: No pollution found in Janitos chat properties.`);
  }
}

console.log("Cleanup complete!");
