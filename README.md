# Prakash Kantumutchu

I build LLM systems that actually ship to production.

Most recent: Architected a multi-tenant RAG pipeline serving 50K+ queries/day with <200ms p99 latency. Fine-tuned domain-specific language models that reduced manual review time by 73%. Built MLOps infrastructure that took model deployment from 3 weeks to 4 hours.

Before ML: Aerospace engineer who got obsessed with what neural networks could do at scale. Spent two years in academia studying optimization theory. Realized the hard problems weren't in papers—they were in production.

**What I'm working on:** Training small, fast LLMs that outperform GPT-3.5 on narrow domains. Building agent architectures that don't hallucinate themselves into failure states. Making Azure ML pipelines actually pleasant to debug.

📍 Noida, India • [Email](mailto:k.prakashofficial@gmail.com) • [Portfolio](https://kpdagrt22.netlify.app/) • [LinkedIn](https://www.linkedin.com/in/prakash-kantumutchu/)

---

## Systems I've Built

**LLM Fine-tuning Infrastructure**
- Trained LoRA adapters on 100M+ token datasets with automated hyperparameter optimization
- Built evaluation frameworks measuring hallucination rates, factual accuracy, and domain coherence
- Reduced inference costs by 60% through quantization and KV-cache optimization

**Production RAG Architecture**
- Multi-stage retrieval: keyword → semantic → reranking with cross-encoder models
- Implemented semantic caching reducing embedding compute by 40% on repeated queries
- Built feedback loops for continuous embedding model improvement based on user interactions

**MLOps & Orchestration**
- Azure ML pipelines with automatic experiment tracking, model versioning, and A/B deployment
- Real-time model monitoring detecting distribution shift before accuracy degrades
- CI/CD for ML: automated testing for data quality, model performance, and API contracts

**NLP at Scale**
- Entity extraction pipelines processing 2M+ documents monthly with custom transformer models
- Multi-label classification achieving 92% F1 on imbalanced datasets through data augmentation
- Built custom tokenizers and vocabulary for domain-specific text (legal, medical, financial)

---

## Technical Philosophy

**I think in systems, not models.** A 90% accurate model that deploys reliably beats a 95% accurate model that breaks in production. I care about latency budgets, error handling, monitoring, and what happens when your database goes down at 3 AM.

**I optimize for iteration speed.** Fast feedback loops matter more than perfect architecture. I build prototypes that fail quickly, then productionize what works. Every pipeline I write has observability baked in from day one.

**I read papers, but ship code.** Attention mechanisms are elegant. But deployment scripts, error handling, and load testing are what separate demos from products.

---

## Tech Stack

**Languages:** Python (daily), SQL (for data people who don't trust ORMs), R (when statisticians are watching)

**ML/DL:** PyTorch • Transformers • LangChain • spaCy • scikit-learn • TensorFlow

**LLM Ops:** Azure OpenAI • HuggingFace • vLLM • ONNX • Triton Inference Server

**Infrastructure:** Azure ML • Docker • Kubernetes • FastAPI • Redis • Airflow • MLflow

**Data:** PostgreSQL • MongoDB • Pinecone • Weaviate • PySpark • dbt

**Cloud:** Azure (AI-102 certified) • AWS • GCP • Oracle OCI

---

## Credentials

**Certifications that actually matter:**
- Azure AI Engineer Associate (AI-102) – the one that requires building real systems
- Oracle OCI 2025 Generative AI Professional – latest gen AI architectures
- Vanderbilt AI Agent Developer – practical agent design patterns

**20+ other certifications** across DataCamp, Microsoft, cloud platforms. Full list available if you care about credential collecting. I don't.

**7 years** building ML systems. Started in aerospace, detoured through academia, landed in production ML because that's where the interesting problems are.

---

## What I'm Learning Right Now

- **Agent architectures** that actually work: ReAct, function calling, tool use, memory systems
- **Multimodal models:** Vision-language models, CLIP embeddings, cross-modal retrieval
- **LLM inference optimization:** Speculative decoding, continuous batching, PagedAttention
- **Prompt engineering** (yes, it's an actual skill): Chain-of-thought, few-shot learning, structured outputs

---

## What I'm Looking For

I want to work on ML systems where failure costs something. Where latency matters. Where you can't just throw GPT-4 at the problem and call it done.

**Interested in:**
- Staff/Principal ML Engineer roles building LLM infrastructure
- Research Engineer positions at AI labs shipping products
- Technical leadership in teams solving hard NLP/Gen AI problems
- Companies that version their datasets and actually monitor their models

**Not interested in:**
- Proof-of-concept projects that never deploy
- "ML teams" that just call OpenAI's API
- Roles where I'm writing SQL 80% of the time
- Companies allergic to testing and monitoring

**Ideal environment:** Strong engineering culture, end-to-end ownership, production systems at scale, remote-friendly, people who've debugged distributed training failures at 2 AM and lived to tell the tale.

---

## Open Source & Community

I believe in learning in public and sharing what works. Currently exploring:
- Fine-tuning strategies for small, efficient models
- RAG patterns that don't fail silently
- MLOps tools that don't make you hate your job

**Contributions welcome.** If you're building production ML systems and want to compare notes, I'm here for it.

---

<div align="center">

**Let's build something that actually works in production.**

*Available for interesting problems • [k.prakashofficial@gmail.com](mailto:k.prakashofficial@gmail.com) • [View Portfolio](https://kpdagrt22.netlify.app/)*

</div>
