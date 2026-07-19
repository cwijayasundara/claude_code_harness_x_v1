# DDD boundaries (when justified)

Load only when the approved ubiquitous language or consistency rules matter.

- Model **concepts, invariants, value objects, aggregates, and domain events**
  only where the product language and consistency boundary require them.
- Keep domain rules free of frameworks, HTTP, ORM, and LLM providers.
- Do **not** invent layers, repositories, or entities for simple DTO plumbing.
- Align names with the project glossary; escalate ambiguous domain meaning to a
  human rather than guessing.
