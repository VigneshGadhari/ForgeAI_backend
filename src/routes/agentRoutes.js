const express = require('express');
const router = express.Router();
const GeminiService = require('../services/geminiService');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const geminiService = new GeminiService(process.env.GEMINI_API_KEY);

router.post('/suggest-agents', async (req, res) => {
  try {
    const { userRequest } = req.body;
    
    if (!userRequest) {
      return res.status(400).json({ 
        error: 'User request is required' 
      });
    }

    const suggestions = await geminiService.getAgentSuggestions(userRequest);
    console.log("Raw suggestions response:", suggestions);

    // Enhanced cleanup of the response
    const cleanedResponse = suggestions
      .replace(/^```(?:json)?\s*/g, '')  // Remove opening ```json or just ```
      .replace(/\s*```$/g, '')      // Remove closing ```
      .replace(/```/g, '')          // Remove any remaining ``` markers
      .replace(/\r\n/g, '\n')       // Normalize line endings
      .trim();

    let parsedSuggestions;
    try {
        parsedSuggestions = JSON.parse(cleanedResponse);
        console.log("Parsed suggestions:", parsedSuggestions);
    } catch (parseError) {
        console.error("Error parsing suggestions:", parseError.message);
        console.log("Cleaned response:", cleanedResponse);
        
        // Attempt additional cleanup if parsing fails
        try {
            const furtherCleanedResponse = cleanedResponse
                .replace(/^\s*```.*\n/, '')  // Remove any remaining markdown markers at start
                .replace(/\n\s*```\s*$/, '') // Remove any remaining markdown markers at end
                .trim();
            parsedSuggestions = JSON.parse(furtherCleanedResponse);
            console.log("Parsed after additional cleaning:", parsedSuggestions);
        } catch (secondError) {
            console.error("Failed second parsing attempt:", secondError.message);
            return res.status(500).json({ 
                error: 'Failed to parse agent suggestions',
                details: secondError.message,
                rawResponse: suggestions
            });
        }
    }
    
    // Initialize array to store all search results
    const searchResults = [];
    
    // Map category names to collection names
    const categoryToCollection = {
      'UI/UX Design Agents': 'ux_design_agents',
      'Code Generation Agents': 'code_generation_agents',
      'API Management Tools': 'api_management_agents',
      'Data Visualization Tools': 'data_visualization_agents',
      'Project Management Agents': 'project_management_agents'
    };

    // Search each relevant collection based on categories
    let allToolsAcrossCategories = [];
    
    for (const category of parsedSuggestions.categories) {
      const collectionName = categoryToCollection[category.name];
      if (collectionName) {
        try {
          // Search across multiple category fields
          const fieldsToSearch = [
            { field: 'description', value: category.description, weight: 0.15 },
            { field: 'usecase', value: category.usecase, weight: 0.35 },
            { field: 'type', value: category.type, weight: 0.20 }
          ];

          let fieldResults = {};
          let toolScores = new Map(); // Track weighted scores for each tool

          for (const searchField of fieldsToSearch) {
            if (searchField.value) {
              const results = await searchService.searchTools(collectionName, searchField.value);
              let matchedTools = [];
              if (results && Array.isArray(results.metadatas)) {
                matchedTools = results.metadatas.map((tool, index) => ({
                  ...tool,
                  rank: index + 1,
                  similarity_score: results.distances[index]
                }));
              } else if (Array.isArray(results)) {
                matchedTools = results;
              } else {
                console.warn(`Unexpected results format for ${collectionName}:`, results);
                continue;
              }

              // Store results by field
              fieldResults[searchField.field] = matchedTools;

              // Calculate weighted scores for each tool
              matchedTools.forEach(tool => {
                const key = JSON.stringify({
                  tool_name: tool.tool_name,
                  description: tool.description
                });

                const currentScore = toolScores.get(key) || {
                  tool,
                  weightedScore: 0,
                  matchedFields: new Set()
                };

                // Calculate score contribution (lower rank is better)
                const maxRank = matchedTools.length;
                const normalizedScore = (maxRank - (tool.rank - 1)) / maxRank; // Convert rank to 0-1 scale
                currentScore.weightedScore += normalizedScore * searchField.weight;
                currentScore.matchedFields.add(searchField.field);
                
                toolScores.set(key, currentScore);
              });
            }
          }

          // Add rating weight to final scores (30%)
          for (const [key, scoreData] of toolScores) {
            const tool = scoreData.tool;
            const ratingScore = (tool.user_rating || 0) / 5; // Normalize rating to 0-1 scale
            scoreData.weightedScore += ratingScore * 0.30;  
          }

          // Convert to array and sort by weighted score
          const sortedTools = Array.from(toolScores.values())
            .sort((a, b) => b.weightedScore - a.weightedScore)
            .map((scoreData, index) => ({
              ...scoreData.tool,
              category: category.name,
              finalRank: index + 1,
              weightedScore: scoreData.weightedScore,
              matchedCriteria: Array.from(scoreData.matchedFields),
              categoryRank: index + 1  // Rank within its category
            }));

          // Store category-specific results
          searchResults.push({
            category: category.name,
            tools: {
              byDescription: fieldResults.description || [],
              byUseCase: fieldResults.usecase || [],
              byType: fieldResults.type || [],
              sortedByRelevance: sortedTools
            }
          });

          // Add tools to the combined list
          allToolsAcrossCategories = [...allToolsAcrossCategories, ...sortedTools];
        } catch (error) {
          console.error(`Error searching ${collectionName}:`, error);
        }
      }
    }
    
    // Parse cost from suggestions
    const parseCost = (costString) => {
      if (!costString) return null;
      // Remove currency symbols and extract number
      const numericCost = parseFloat(costString.replace(/[^0-9.]/g, ''));
      return isNaN(numericCost) ? null : numericCost;
    };

    // Inside the try block of suggest-agents route
    const userCost = parseCost(parsedSuggestions.cost);
    console.log("Parsed user cost:", userCost);

    // Calculate final global ranking with cost consideration
    const getAdjustedScore = (tool, userCost) => {
      // Get the lowest price tier available
      const getLowestPrice = (tool) => {
        const prices = [
          parseCost(tool.starter_price),
          parseCost(tool.pro_price),
          parseCost(tool.org_price),
          parseCost(tool.enterprise_price)
        ].filter(price => !isNaN(price) && price !== null);
        
        return prices.length > 0 ? Math.min(...prices) : Infinity;
      };

      // If user specified a cost constraint, check if tool is within budget
      if (userCost) {
        const lowestPrice = getLowestPrice(tool);
        if (lowestPrice > userCost) {
          return -1; // Tool is over budget
        }
      }

      const criteriaScore = tool.matchedCriteria.length / 3; // Max criteria is 3
      const rankScore = 1 - (tool.categoryRank - 1) / 10;
      const weightedScore = tool.weightedScore;

      // Price score - lower price gets higher score
      const priceScore = userCost ? 1 - (getLowestPrice(tool) / userCost) : 1;
      
      // Updated formula including price consideration:
      // 35% weightedScore + 25% criteriaMatch + 25% categoryRank + 15% priceScore
      return (weightedScore * 0.35) + 
             (criteriaScore * 0.25) + 
             (rankScore * 0.25) + 
             (priceScore * 0.15);
    };

    const finalSortedTools = allToolsAcrossCategories
      .map(tool => {
        const score = getAdjustedScore(tool, userCost);
        return {
          ...tool,
          finalScore: score,
          withinBudget: score >= 0
        };
      })
      .filter(tool => tool.withinBudget) // Only keep tools within budget
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((tool, index) => ({
        ...tool,
        globalRank: index + 1,
        pricing: {
          starter: parseCost(tool.starter_price),
          pro: parseCost(tool.pro_price),
          org: parseCost(tool.org_price),
          enterprise: parseCost(tool.enterprise_price),
          lowestTier: Math.min(
            ...[
              parseCost(tool.starter_price),
              parseCost(tool.pro_price),
              parseCost(tool.org_price),
              parseCost(tool.enterprise_price)
            ].filter(price => !isNaN(price) && price !== null)
          )
        }
      }));

    // Handle empty results gracefully
    if (finalSortedTools.length === 0) {
      return res.json({
        suggestions: parsedSuggestions,
        categorizedRankings: {
          summary: [],
          detailedCategories: [],
          message: userCost ? 
            `No tools found within budget of ${parsedSuggestions.cost}` : 
            'No matching tools found'
        }
      });
    }

    // Group and rank tools by category
    const categoryGroups = {};
    finalSortedTools.forEach(tool => {
      if (!categoryGroups[tool.category]) {
        categoryGroups[tool.category] = {
          categoryName: tool.category,
          averageScore: 0,
          budgetConstraint: parsedSuggestions.cost,
          tools: []
        };
      }
      categoryGroups[tool.category].tools.push(tool);
    });

    // Calculate average score for each category and sort tools within categories
    Object.values(categoryGroups).forEach(group => {
      // Calculate average score for the category
      group.averageScore = group.tools.reduce((sum, tool) => sum + tool.finalScore, 0) / group.tools.length;
      
      // Sort tools within category by finalScore
      group.tools.sort((a, b) => b.finalScore - a.finalScore);
      
      // Add rank within category
      group.tools = group.tools.map((tool, index) => ({
        ...tool,
        categoryRankByScore: index + 1
      }));
    });

    // Sort categories by their average scores
    const rankedCategories = Object.values(categoryGroups)
      .sort((a, b) => b.averageScore - a.averageScore)
      .map((group, index) => ({
        ...group,
        categoryRank: index + 1
      }));

    // Add error handling for price range calculation
    const getPriceRange = (tools) => {
      try {
        const validPrices = tools
          .map(t => t.pricing.lowestTier)
          .filter(price => !isNaN(price) && price !== null && price !== Infinity);
        
        return validPrices.length > 0 ? {
          min: Math.min(...validPrices),
          max: Math.max(...validPrices)
        } : { min: null, max: null };
      } catch (error) {
        console.error('Error calculating price range:', error);
        return { min: null, max: null };
      }
    };
    // res.json({
    //     detailedCategories: rankedCategories
    // });

    const workflows = {
          id: parsedSuggestions.name.toLowerCase().replace(/\s+/g, '-'),
          name: parsedSuggestions.name,
          description: parsedSuggestions.description,
          thumbnail: "", 
          category: parsedSuggestions.category,
          agents: rankedCategories.map(category => {
            const topTool = category.tools[0];
            return {
              id: topTool.tool_name,
              name: topTool.tool_name.toLowerCase().replace(/\s+/g, '-'),
              description: topTool.description,
              category: topTool.category,
              features: {
                input: topTool.input_type ? topTool.input_type.split(',').map(s => s.trim()) : [],
                output: topTool.output_type,
                useCase: topTool.primary_use_case,
                pricing: {
                  free: topTool.starter_price?.toLowerCase().includes('free') || false,
                  paid: topTool.pricing.lowestTier || Math.floor(Math.random() * 50)
                },
                platforms: topTool.supported_platforms ? topTool.supported_platforms.split(',').map(s => s.trim()) : [],
                integration: topTool.integration_options ? topTool.integration_options.split(',').map(s => s.trim()) : [],
                users: parseInt(topTool.review_count) || 0,
                accuracy: topTool.performance_metrics
              },
              documentation: topTool.learning_resources || '',
              tutorial: topTool.learning_resources || '',
              imageUrl: topTool.img_link || '',
              implementationLevel: topTool.impl_level || 'Medium',
              rating: parseFloat(topTool.user_rating) || 0
            };
          })
      }
    
    res.json({"workflows":workflows});
  } catch (error) {
    console.error('Error suggesting agents:', error);
    res.status(500).json({ 
      error: 'Failed to process agent suggestions' 
    });
  }
});

const searchService = require('../services/searchService');

router.post('/search', async (req, res) => {
    try {
        const { collection_name, query } = req.body;

        if (!collection_name || !query) {
            return res.status(400).json({ 
                error: 'Missing required parameters: collection_name and query are required' 
            });
        }

        const results = await searchService.searchTools(collection_name, query);
        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: error.message });
    }
});

function convertExcelToJson(filePath) {
    // Read the Excel/CSV file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert sheet to raw JSON
    const rawData = XLSX.utils.sheet_to_json(sheet);
    
    // Transform the data to the required format
    return rawData.map((row, index) => {
        // Split string fields that should be arrays
        const inputTypes = row['Input Type'] ? row['Input Type'].split(',').map(s => s.trim()) : [];
        const platforms = row['Supported Platforms'] ? row['Supported Platforms'].split(',').map(s => s.trim()) : [];
        const integrations = row['Integration Options'] ? row['Integration Options'].split(',').map(s => s.trim()) : [];

        // Determine if there's a free tier
        const hasFreeOption = row['Pricing Model'] && 
            row['Pricing Model'].toLowerCase().includes('free');

        // Construct pricing string from available price tiers
        const pricingTiers = [
            row['Starter Price (per month in dollars)'] && 
                (isNaN(row['Starter Price (per month in dollars)']) ? 
                    row['Starter Price (per month in dollars)'] : 
                    `${row['Starter Price (per month in dollars)']}`),
            row['Professional Price (per month in dollars)'] && 
                (isNaN(row['Professional Price (per month in dollars)']) ? 
                    row['Professional Price (per month in dollars)'] : 
                    `${row['Professional Price (per month in dollars)']}`),
            row['Organization Price (per month in dollars)'] && 
                (isNaN(row['Organization Price (per month in dollars)']) ? 
                    row['Organization Price (per month in dollars)'] : 
                    `${row['Organization Price (per month in dollars)']}`),
            row['Enterprise Price (per month in dollars)'] && 
                (isNaN(row['Enterprise Price (per month in dollars)']) ? 
                    row['Enterprise Price (per month in dollars)'] : 
                    `${row['Enterprise Price (per month in dollars)']}`)
        ].filter(Boolean);

        // Extract the first non-free price
        const firstPaidPrice = pricingTiers.find(price => price !== 'Free');
        let paidPrice = firstPaidPrice ? parseInt(firstPaidPrice) : null;
        return {
            id: `agent_${index + 1}`,
            name: row['Tool Name'],
            description: row['Description'],
            category: row['Category'],
            features: {
                input: inputTypes,
                output: row['Output Type'],
                useCase: row['Primary Use Case'],
                pricing: {
                    free: hasFreeOption,
                    paid: paidPrice || Math.floor(Math.random() * 50)
                },
                platforms: platforms,
                integration: integrations,
                users: parseInt(row['Review Count']) || 0,
                accuracy: row['Performance Metrics'] || 'N/A'
            },
            documentation: row['Documentation Link'] || '',
            tutorial: row['Learning Resources'] || '',
            imageUrl: row['Image Link'] || '',
            implementationLevel: row['Implementation difficulty level'] || 'Medium',
            rating: parseFloat(row['User Rating']) || 0
        };
    });
}

router.get('/agents', (req, res) => {
    try {
        const agentsDir = path.join(__dirname, '..', 'dataProcessing', 'agents');
        const result = {};

        // Read all CSV files in the agents directory
        const files = fs.readdirSync(agentsDir).filter(file => file.endsWith('.csv'));

        files.forEach(file => {
            const filePath = path.join(agentsDir, file);
            const fileName = path.basename(file, '.csv'); // Remove .csv extension
            result[fileName] = convertExcelToJson(filePath);
        });

        res.json({
            success: true,
            data: result,
            metadata: {
                totalAgents: Object.values(result)
                    .reduce((sum, category) => sum + category.length, 0),
                categories: Object.keys(result)
            }
        });

    } catch (error) {
        console.error('Error processing files:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

router.get('/workflows', (req, res) => {
  const workflow =[
      {
        "id": "api-development-flow",
        "name": "Complete API Development Pipeline",
        "description": "End-to-end API development workflow from design to testing and documentation",
        "thumbnail": "https://images.pexels.com/photos/7367/startup-photo.jpg?auto=compress&cs=tinysrgb&w=600",
        "category": "API Development",
        "agents": [
          {
            "id": "agent_1",
            "name": "SwaggerHub",
            "description": "API design, documentation, and collaboration platform.",
            "category": "API Management Tools",
            "features": {
              "input": ["OpenAPI Definitions"],
              "output": "API Documentation, Mock Servers",
              "useCase": "API Design, Documentation, Collaboration",
              "pricing": {
                "free": true,
                "paid": 75
              },
              "platforms": ["Web"],
              "integration": ["Various Integrations"],
              "users": 5000,
              "accuracy": "High User Satisfaction"
            },
            "documentation": "https://swagger.io/tools/swaggerhub/",
            "tutorial": "https://swagger.io/tools/swaggerhub/",
            "imageUrl": "https://firebasestorage.googleapis.com/v0/b/xpress-bbe8e.appspot.com/o/Forge_dataimage%2FAPI%20Management%20Tools%2FSwaggerHub.png?alt=media&token=203672b5-1f94-4482-a99b-9bc1bd335d3c",
            "implementationLevel": "Medium",
            "rating": 4.7
          },
          {
            "id": "agent_2",
            "name": "Postman",
            "description": "Collaboration and testing platform for APIs.",
            "category": "API Management Tools",
            "features": {
              "input": ["API Definitions", "Requests"],
              "output": "API Documentation, Test Results",
              "useCase": "API Development, Testing, Collaboration",
              "pricing": {
                "free": true,
                "paid": 12
              },
              "platforms": ["Web", "Desktop"],
              "integration": ["Various Integrations"],
              "users": 10000,
              "accuracy": "High User Satisfaction"
            },
            "documentation": "https://www.postman.com/",
            "tutorial": "https://www.postman.com/",
            "imageUrl": "https://firebasestorage.googleapis.com/v0/b/xpress-bbe8e.appspot.com/o/Forge_dataimage%2FAPI%20Management%20Tools%2FPostman.png?alt=media&token=3237086f-e177-4f86-9727-b4b0ece7b4b1",
            "implementationLevel": "Easy",
            "rating": 4.8
          }
        ]
      },
      {
        "id": "ai-assisted-development",
        "name": "AI-Powered Development Workflow",
        "description": "Enhance development productivity with AI code assistance and project management",
        "thumbnail": "https://images.pexels.com/photos/1181671/pexels-photo-1181671.jpeg?auto=compress&cs=tinysrgb&w=600",
        "category": "Development",
        "agents": [
          {
            "id": "agent_1",
            "name": "GitHub Copilot",
            "description": "AI-powered code completion tool.",
            "category": "Code Generation Agents",
            "features": {
              "input": ["Code", "Natural Language"],
              "output": "Code",
              "useCase": "Code Generation, Code Completion",
              "pricing": {
                "free": true,
                "paid": 10
              },
              "platforms": ["Visual Studio Code", "VS Code", "Neovim", "JetBrains IDEs"],
              "integration": ["GitHub"],
              "users": 5000,
              "accuracy": "High Accuracy"
            },
            "documentation": "https://docs.github.com/en/copilot",
            "tutorial": "https://docs.github.com/en/copilot",
            "imageUrl": "https://firebasestorage.googleapis.com/v0/b/xpress-bbe8e.appspot.com/o/Forge_dataimage%2FCode%20Generation%20Agents%2FGitHub%20Copilot.jpg?alt=media&token=b4a12a9a-6395-4567-9796-7d32d7f1f999",
            "implementationLevel": "Easy",
            "rating": 4.8
          },
          {
            "id": "agent_2",
            "name": "Monday.com",
            "description": "Work OS with AI-powered features",
            "category": "Project Management Agents",
            "features": {
              "input": ["Project data", "user input"],
              "output": "Task suggestions, timelines, reports",
              "useCase": "Project management, Workflow automation",
              "pricing": {
                "free": true,
                "paid": 10
              },
              "platforms": ["Web", "Mobile", "Desktop"],
              "integration": ["Various integrations"],
              "users": 5000,
              "accuracy": "AI-powered suggestions, Workflow automation"
            },
            "documentation": "https://monday.com/",
            "tutorial": "https://monday.com/",
            "imageUrl": "https://firebasestorage.googleapis.com/v0/b/xpress-bbe8e.appspot.com/o/Forge_dataimage%2FProject%20Management%20Agents%2Fmonday.png?alt=media&token=67a69ae0-965d-491b-82c4-309dbf08234c",
            "implementationLevel": "Low",
            "rating": 4.5
          }
        ]
      },
      {
        "id": "enterprise-api-management",
        "name": "Enterprise API Management Suite",
        "description": "Comprehensive API management solution for large-scale enterprise deployments",
        "thumbnail": "https://images.pexels.com/photos/1181677/pexels-photo-1181677.jpeg?auto=compress&cs=tinysrgb&w=600",
        "category": "Enterprise",
        "agents": [
          {
            "id": "agent_1",
            "name": "Apigee",
            "description": "Full-lifecycle API management platform.",
            "category": "API Management Tools",
            "features": {
              "input": ["API Definitions", "Traffic"],
              "output": "API Gateway, Analytics, Security",
              "useCase": "Enterprise-grade API Management",
              "pricing": {
                "free": false,
                "paid": 30
              },
              "platforms": ["Cloud-based"],
              "integration": ["Various Integrations"],
              "users": 3000,
              "accuracy": "High Performance, Scalability"
            },
            "documentation": "https://cloud.google.com/apigee/",
            "tutorial": "https://cloud.google.com/apigee/",
            "imageUrl": "https://firebasestorage.googleapis.com/v0/b/xpress-bbe8e.appspot.com/o/Forge_dataimage%2FAPI%20Management%20Tools%2FApigee.png?alt=media&token=64ef8ea4-0e6a-42e2-9119-2a92a5fd1f38",
            "implementationLevel": "Medium",
            "rating": 4.5
          },
          {
            "id": "agent_2",
            "name": "Jira",
            "description": "Project tracking and bug tracking software with AI features",
            "category": "Project Management Agents",
            "features": {
              "input": ["Project data", "user input"],
              "output": "Task suggestions, issue tracking, reports",
              "useCase": "Agile development, Software development",
              "pricing": {
                "free": true,
                "paid": 25
              },
              "platforms": ["Web", "Desktop"],
              "integration": ["Various integrations"],
              "users": 2500,
              "accuracy": "Powerful for Agile development, Issue tracking"
            },
            "documentation": "https://www.atlassian.com/software/jira",
            "tutorial": "https://www.atlassian.com/software/jira",
            "imageUrl": "https://firebasestorage.googleapis.com/v0/b/xpress-bbe8e.appspot.com/o/Forge_dataimage%2FProject%20Management%20Agents%2FJira.jpg?alt=media&token=a5bfad18-8ef3-4a03-905e-7c110cd21728",
            "implementationLevel": "Medium",
            "rating": 4.2
          }
        ]
      }
    ]
  

    res.json({
        workflows: workflow
    });
});

module.exports = router; 