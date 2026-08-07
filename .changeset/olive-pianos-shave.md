---
"@degliersa/raven-odm": patch
---

Stop marking HiLo payloads with a private Symbol. The collection descriptor now identifies itself rather than the documents that happened to pass through the HiLo branch, and RavenDB resolves the collection for a HiLo id from the descriptor directly. Ids, collection names, and document contents are unchanged.
