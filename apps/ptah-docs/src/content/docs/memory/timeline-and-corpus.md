---
title: Timeline & Corpus
description: Browse memories in time order, and save a memory filter as a named corpus.
---

# Timeline & Corpus

The **Memory** tab in **Thoth** has a row of view tabs: **Memories**, **Timeline**, **Corpus**, **Code index**, and **Maintenance**. This page describes the **Timeline** and **Corpus** views.

## Timeline

The **Timeline** view shows memories as a list of compact rows. Each row shows the memory type, the time the memory was captured, and its score. When the memory has a subject, concepts, or files, the row shows them too.

### Filter the timeline

The filter strip is at the top of the view.

| Control | What it does |
| ------- | ------------ |
| Search box (**Filter timeline (BM25 + filters)...**) | A text query for the rows |
| **Bugfix**, **Feature**, **Decision**, **Discovery**, **Refactor**, **Change** | Memory type chips. Click a chip to include that type. Click it again to remove it |
| **Concepts (comma-separated)** | Show only rows with these concepts |
| **Files (comma-separated)** | Show only rows with these files |
| **From** and **To** | A date range |
| **Apply** | Runs the search with the current filters |
| **Reset** | Clears all filters and the anchor |

When vector embeddings are not available for a search, a **BM25 only** badge shows next to the date range. For more about the two search methods, see [Searching memory](/memory/searching/).

To filter the timeline:

1. Open **Thoth → Memory**.
2. Click the **Timeline** view tab.
3. Type a query, or select memory types, concepts, files, or a date range.
4. Click **Apply**.

If no row matches, the view shows **No timeline events**. Make the date range wider, or remove concept or file filters.

### Anchor on a memory

Each row has a **Timeline** button. Click it to anchor the timeline on that memory. The list then shows the memory and its nearest neighbors in time: up to five before it and five after it.

While an anchor is set, the view shows **Anchored on** with the memory ID. Click **Clear anchor** to go back to the filtered list.

### Load more rows

The view loads 50 rows at a time. When more rows are available, a **Load more** button shows below the list. Click it to load the next 50 rows.

## Corpus

A corpus is a named snapshot of a memory filter. You can open a chat that starts with the corpus loaded, so that you can ask questions about it.

The **Corpus** view has two parts: **Suggested boards** and the **Knowledge corpora** list.

### Knowledge corpora

The **Knowledge corpora** list shows each corpus with its name, the number of memories, and the time it was built. After a rebuild, the row also shows the time of the rebuild.

Each row has these actions:

| Action | What it does |
| ------ | ------------ |
| **Prime in new chat** | Opens a new chat session that starts with the corpus loaded |
| **Reprime** | Ends the primed sessions of the corpus and opens a new one |
| **Rebuild** | Runs the saved filter again to add new memories. The result shows how many memories were added and removed |
| **Delete** | Deletes the corpus after you confirm. The memories stay. Only the snapshot is removed |

Click **Refresh** to read the list again.

### Build a corpus

1. Open **Thoth → Memory**.
2. Click the **Corpus** view tab.
3. Click **Build corpus**.
4. In the **Build new corpus** dialog, type a **Name**.
5. Optional: set the filter fields (see the table below).
6. Click **Build**.

The **Build** button is available only when the name is not empty. Each corpus name must be unique.

| Field | What it does |
| ----- | ------------ |
| **Name** | The name of the corpus |
| Memory type chips | Include only the selected memory types |
| **Concepts (comma-separated)** | Include only memories with these concepts |
| **Files (comma-separated)** | Include only memories with these files |
| **Query (optional)** | A search query for the memories |
| **Limit** | The maximum number of memories. The default is `100` and the maximum is `500` |
| **Scope to current workspace** | Include only memories from the open workspace. On by default |

When the build is complete, a message shows the name of the corpus and its number of memories.

### Suggested boards

**Suggested boards** are corpora that PtahCode proposes from clusters of your memories. Each card shows a name, the number of memories, the top concepts, and the reason for the suggestion.

- Click **Create** to build the corpus from the suggestion.
- Click **×** to dismiss the suggestion.

## Related

- [How memory works](/memory/how-it-works/)
- [Searching memory](/memory/searching/)
- [Memory maintenance](/memory/maintenance/)
