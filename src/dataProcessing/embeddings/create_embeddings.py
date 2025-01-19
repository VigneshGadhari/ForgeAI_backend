from embedding_utils import UIUXToolsEmbeddingManager
import os

def main():
    # Initialize the embedding manager
    agent_types = [
        ("ux_design_agents", "UX Design Agents.csv"),
        ("code_generation_agents", "Code Generation Agents.csv"),
        ("api_management_agents", "API Management Tools.csv"),
        ("data_visualization_agents", "Data Visualization Tools AI Agents.csv"),
        ("project_management_agents", "Project Management Agents.csv"),
    ]
    
    db_path_base = os.path.join(os.path.dirname(__file__), '../../data')
    manager = UIUXToolsEmbeddingManager(db_path_base)
    
    for agent_type, csv_file in agent_types:
        # Process CSV data
        csv_path = os.path.join(os.path.dirname(__file__), '../agents/', csv_file)
        documents = manager.process_csv_data(csv_path)
        
        # Create and populate collection
        collection = manager.create_collection(agent_type)
        manager.add_documents_to_collection(collection, documents)
        
        # Example search
        results = manager.search_similar_tools(
            collection,
            "I need a collaborative design tool with real-time editing features",
            n_results=3
        )
        
        print(f"Search Results for {agent_type}:")
        for idx, (doc, metadata) in enumerate(zip(results['documents'][0], results['metadatas'][0])):
            print(f"\nResult {idx + 1}:")
            print(f"Tool: {metadata['tool_name']}")
            print(f"Category: {metadata['category']}")
            print(f"Rating: {metadata['user_rating']} ({metadata['review_count']} reviews)")
            print(f"Integration Options: {metadata['integration_options']}")
            print(f"Setup Complexity: {metadata['setup_complexity']}")
            print(f"Security Level: {metadata['data_security']}")
            print(f"Description: {doc[:200]}...")
            print("-" * 80)

if __name__ == "__main__":
    main()