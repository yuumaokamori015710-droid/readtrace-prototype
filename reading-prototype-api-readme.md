# ReadTrace Prototype: Book APIs

The prototype uses free, keyless book APIs directly from the browser so it can
run on GitHub Pages.

```text
Browser -> NDL Search OpenSearch API
Browser -> openBD ISBN API
Browser -> Open Library search API
```

## APIs

- NDL Search: Japanese title search through the OpenSearch endpoint.
- openBD: Japanese bibliographic metadata and cover correction when an ISBN is available.
- Open Library: international/English title search, author names, ISBNs, and cover candidates.
- Local sample catalog: fallback for searches with no external result.

## Search Flow

1. If the search query looks like an ISBN, call openBD directly.
2. If the query contains Japanese text, search NDL Search by title with `dpid=iss-ndl-opac`.
3. Keep book-like NDL results and enrich ISBN candidates with openBD.
4. For non-Japanese queries, or when NDL has no usable result, search Open Library.
5. Merge external results with the local sample catalog.

## Notes

- No Google Books API key is required for the GitHub Pages prototype.
- NDL Search is best for Japanese title discovery.
- openBD is best for Japanese books when the ISBN is known.
- Open Library is best for international/English title search.
- NDL Search requires visible credit and has usage guidance for commercial or continuous access.
- For a production app, cache results and keep a user-editable book master.
