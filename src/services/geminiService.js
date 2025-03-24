const { GoogleGenerativeAI } = require("@google/generative-ai");
const agentCategories = require('../models/agentCategories');

class GeminiService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  async getChatSession() {
    return this.model.startChat({
      history: [],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    });
  }

  async getAgentSuggestions(userRequest) {
    const chat = await this.getChatSession();
    
    // Create a formatted list of available categories
    const availableCategories = Object.values(agentCategories)
      .map(cat => `- ${cat.name}: ${cat.description}`)
      .join('\n');
    
    const prompt = `
      Based on the following user request, suggest the most relevant AI agent categories from the list below.
      Only return categories from this predefined list and maintain the exact names.

      Available Categories:
      ${availableCategories}

      User Request: ${userRequest}
      
      Return format should be adjusted to search in a rag model:
      {
        "name":"name of the project",
        "description": "description of the project",
        "category": "General Category of the project",
        "cost": "budget of the project as per the user, leave blank if not provided",
        "categories": [
          {
            "name": "Category Name",
            "description": "Category Description",
            "usecase": "usecase of the project in this category",
            "type": "type of the project(web/app/etc) project in this category",
          }
        ]
      }

      Ensure that:
      1. Only categories from the provided list are included
      2. The exact category names and descriptions are used
      3. Each category has a priority level assigned
      4. The response is returned in a json parsable format
    `;

    const result = await chat.sendMessage(prompt);
    return result.response.text();
  }
}

module.exports = GeminiService; 
