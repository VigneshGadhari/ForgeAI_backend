import google.generativeai as genai
from typing import List, Dict, Any
import pandas as pd
import chromadb
import os
from dotenv import load_dotenv

load_dotenv()

class GeminiEmbeddingGenerator:
    def __init__(self):
        # Initialize Gemini with API key
        genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
        self.model = genai.GenerativeModel('gemini-pro')
        
    def generate_embedding(self, text: str) -> List[float]:
        """Generate embeddings for a single text using Gemini"""
        try:
            # Use the embedContent method instead of generate_embeddings
            response = genai.embed_content(
                model="models/embedding-001",
                content=text,
                task_type="retrieval_document"
            )
            return response['embedding']
        except Exception as e:
            print(f"Error generating embedding: {e}")
            return []

class UIUXToolsEmbeddingManager:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.embedding_generator = GeminiEmbeddingGenerator()
        self.chroma_client = chromadb.PersistentClient(path=db_path)
        
    def process_csv_data(self, csv_path: str) -> List[Dict[str, Any]]:
        """Process CSV file and prepare documents for embedding"""
        df = pd.read_csv(csv_path)
        documents = []
        
        for _, row in df.iterrows():
            # Create a comprehensive text representation of each tool
            doc_text = f"""
            Tool: {row['Tool Name']}
            Category: {row['Category']}
            Description: {row['Description']}
            Input Type: {row['Input Type']}
            Output Type: {row['Output Type']}
            Primary Use Case: {row['Primary Use Case']}
            Pricing Model: {row['Pricing Model']}
            Integration Options: {row['Integration Options']}
            API Availability: {row['API Availability']}
            Documentation: {row['Documentation Link']}
            Limitations: {row['Limitations']}
            Setup Complexity: {row['Setup Complexity']}
            Automation Features: {row['Automation Features']}
            Output Compatibility: {row['Output Compatibility']}
            Data Security Level: {row['Data Security Level']}
            Performance Metrics: {row['Performance Metrics']}
            Market Trends: {row['Market Trends']}
            Real-world Examples: {row['Real-world Examples']}
            Learning Resources: {row['Learning Resources']}
            Supported Platforms: {row['Supported Platforms']}
            User Rating: {row['User Rating']}
            Review Count: {row['Review Count']}
            Image Link: {row['Image Link']}
            Starter Price: {row['Starter Price (per month in dollars)']}
            Pro Price: {row['Professional Price (per month in dollars)']}
            Org Price: {row['Organization Price (per month in dollars)']}
            Enterprise Price: {row['Enterprise Price (per month in dollars)']}
            Implementation Level: {row['Implementation difficulty level']}
            """
            
            metadata = {
                'tool_name': row['Tool Name'],
                'category': row['Category'],
                'description': row['Description'],
                'input_type': row['Input Type'],
                'output_type': row['Output Type'],
                'primary_use_case': row['Primary Use Case'],
                'pricing_model': row['Pricing Model'],
                'supported_platforms': row['Supported Platforms'],
                'integration_options': row['Integration Options'],
                'user_rating': row['User Rating'],
                'review_count': row['Review Count'],
                'setup_complexity': row['Setup Complexity'],
                'data_security': row['Data Security Level'],
                'limitations': row['Limitations'],
                'real_world_examples': row['Real-world Examples'],
                'learning_resources': row['Learning Resources'],
                'automation_features': row['Automation Features'],
                'output_compatibility': row['Output Compatibility'],
                'performance_metrics': row['Performance Metrics'],
                'market_trends': row['Market Trends'],
                'img_link': row['Image Link'],
                'starter_price': row['Starter Price (per month in dollars)'],
                'pro_price': row['Professional Price (per month in dollars)'],
                'org_price': row['Organization Price (per month in dollars)'],
                'enterprise_price': row['Enterprise Price (per month in dollars)'],
                'impl_level': row['Implementation difficulty level']
            }
            
            documents.append({
                'text': doc_text.strip(),
                'metadata': metadata
            })
            
        return documents

    def create_collection(self, collection_name: str) -> chromadb.Collection:
        """Create a new Chroma collection"""
        return self.chroma_client.create_collection(
            name=collection_name,
            metadata={"description": "UI/UX Design Tools Database"}
        )

    def add_documents_to_collection(self, collection: chromadb.Collection, documents: List[Dict[str, Any]]):
        """Add documents to the collection with their embeddings"""
        for idx, doc in enumerate(documents):
            embedding = self.embedding_generator.generate_embedding(doc['text'])
            if embedding:  # Only add if we got a valid embedding
                collection.add(
                    ids=[f"doc_{idx}"],
                    embeddings=[embedding],
                    documents=[doc['text']],
                    metadatas=[doc['metadata']]
                )

    def search_similar_tools(self, collection: chromadb.Collection, query: str, n_results: int = 5):
        """Search for similar tools based on a query"""
        query_embedding = self.embedding_generator.generate_embedding(query)
        if not query_embedding:
            return None
            
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results
        )
        
        return results