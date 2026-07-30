const fs = require('fs');
const path = require('path');

const graphPath = path.join('/Users/aurelhullenhagen/Development/BrainExtender/data', 'knowledge_graph.json');
if (fs.existsSync(graphPath)) {
  const data = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  
  if (data.entities) {
    let modified = false;
    data.entities = data.entities.map(rel => {
      if (rel.entity1 === 'Aurel' && rel.entity2 === 'Alina' && rel.relation === 'Vater von') {
        modified = true;
        return { ...rel, relation: 'Ex-Freund von' };
      }
      if (rel.entity1 === 'Alina' && rel.entity2 === 'Aurel' && rel.relation === 'Tochter von') {
        modified = true;
        return { ...rel, relation: 'Ex-Freundin von' };
      }
      // Also fix any other possible mixups
      if (rel.entity2 === 'Mutter von Alina' && rel.entity1 === 'Aurel') {
         // Aurel is not the mother of Alina
      }
      return rel;
    });
    
    // Ensure the correct relationship exists just in case
    const hasEx = data.entities.some(r => r.entity1 === 'Alina' && r.entity2 === 'Aurel' && r.relation === 'Ex-Freundin von');
    if (!hasEx) {
      data.entities.push({
        entity1: "Alina",
        relation: "Ex-Freundin von",
        entity2: "Aurel"
      });
      modified = true;
    }
    
    if (modified) {
      fs.writeFileSync(graphPath, JSON.stringify(data, null, 2));
      console.log("Fixed Alina relations in knowledge_graph.json");
    } else {
      console.log("No changes needed in knowledge_graph.json");
    }
  }
} else {
  console.log("knowledge_graph.json not found");
}
