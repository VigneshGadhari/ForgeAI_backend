import chromadb
import sys
import json
import os
from pathlib import Path
import google.generativeai as genai
from typing import List
from chromadb.utils.embedding_functions import EmbeddingFunction

class GeminiEmbeddingFunction(EmbeddingFunction):
    def __init__(self):
        # Initialize Gemini with API key
        genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
        
    def __call__(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts using Gemini"""
        embeddings = []
        for text in texts:
            try:
                response = genai.embed_content(
                    model="models/embedding-001",
                    content=text,
                    task_type="retrieval_document"
                )
                embeddings.append(response['embedding'])
            except Exception as e:
                print(f"Error generating embedding: {e}")
                embeddings.append([0] * 768)  # Return zero vector on error
        return embeddings

def search_tools(collection_name, query):
    try:
        print(collection_name, query)
        # Get the absolute path to the chroma_db directory
        db_path = os.path.join(os.path.dirname(__file__), '../../data')
        
        # Ensure the directory exists
        os.makedirs(db_path, exist_ok=True)
        
        # Use Gemini embedding function
        gemini_ef = GeminiEmbeddingFunction()
        
        # Initialize ChromaDB client with absolute path
        client = chromadb.PersistentClient(path=db_path)
        
        try:
            # Get the collection with Gemini embedding function
            collection = client.get_collection(
                name=collection_name,
                embedding_function=gemini_ef
            )
        except Exception as e:
            print(json.dumps({
                "error": f"Collection not found: {collection_name}. Error: {str(e)}"
            }))
            sys.exit(1)
        
        # Search for similar items
        results = collection.query(
            query_texts=[query],
            n_results=3
        )
        
        # Convert results to JSON-serializable format
        response = {
            "ids": results["ids"][0],
            "distances": results["distances"][0],
            "metadatas": results["metadatas"][0] if results.get("metadatas") else results["documents"][0]
        }
        
        # Print JSON string (will be captured by Node.js)
        print(json.dumps(response))
        
    except Exception as e:
        error_response = {
            "error": f"Search error: {str(e)}",
            "details": {
                "collection": collection_name,
                "query": query,
                "db_path": db_path
            }
        }
        print(json.dumps(error_response))
        sys.exit(1)

if __name__ == "__main__":
    # Expect collection_name and query as command line arguments
    if len(sys.argv) != 3:
        print(json.dumps({
            "error": "Invalid number of arguments",
            "usage": "python search_tools.py <collection_name> <query>"
        }))
        sys.exit(1)
        
    collection_name = sys.argv[1]
    query = sys.argv[2]
    search_tools(collection_name, query) 