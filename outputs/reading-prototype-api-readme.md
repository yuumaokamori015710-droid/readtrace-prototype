# ReadTrace Prototype: Book APIs

The prototype uses free, keyless book APIs directly from the browser so it can
run on GitHub Pages.

```text
Browser -> Open Library search API
Browser -> openBD ISBN API
```

## APIs

- Open Library: title search, author names, ISBNs, and cover candidates.
- openBD: Japanese bibliographic metadata and cover correction when an ISBN is available.
- Local sample catalog: fallback for searches with no external result.

## Search Flow

1. If the search query looks like an ISBN, call openBD directly.
2. Otherwise, search Open Library by title.
3. If Open Library returns ISBNs, enrich up to 12 candidates with openBD.
4. Merge external results with the local sample catalog.

## Notes

- No Google Books API key is required for the GitHub Pages prototype.
- Open Library is best for international/English title search.
- openBD is best for Japanese books when the ISBN is known.
- For a production app, cache results and keep a user-editable book master.
