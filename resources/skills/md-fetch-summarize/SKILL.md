---
name: md-fetch-summarize
version: 1.0.0
description: Fetch a URL and return a concise markdown summary. Read-only.
allowed-tools:
  - WebFetch
  - Bash
---

## Fetch & Summarize

Given a URL, fetch its content and return a concise markdown summary.

Steps:
1. Fetch the page with `WebFetch` (or `Bash` with `curl -sL <url> | head -200` as a fallback).
2. Extract the main content — ignore nav, footer, ads, and boilerplate.
3. Return a structured summary with:
   - **Title** (the page's `<title>` or heading)
   - **One-paragraph overview** of what the page is about
   - **Key points** as a bullet list (max 5)
   - **Source** — the URL fetched

Do not save or write the fetched content anywhere. Return the summary directly.
