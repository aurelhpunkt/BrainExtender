const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("API-Key nicht in .env gefunden.");
    return;
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);
  
  try {
    // Note: listModels is a method on the SDK client
    // For older SDKs: genAI.listModels() or via model manager.
    // In @google/generative-ai, listModels might not be exposed directly in all versions, 
    // but let's try standard fetch or SDK listModels:
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    console.log("=== VERFÜGBARE MODELLE ===");
    if (data.models) {
      data.models.forEach(m => {
        console.log(`Name: ${m.name}, DisplayName: ${m.displayName}, SupportedMethods: ${m.supportedGenerationMethods.join(', ')}`);
      });
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
