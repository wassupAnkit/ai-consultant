# Partner name lists (for `bun run partners:discover`)

experteducation.com renders every non-Australian partner tab client-side, so the
crawler cannot read those institution names. To complete the registry for a
country, open https://experteducation.com/nepal/our-education-partners/, click the
country tab, and paste the institution names into a file here — one per line,
`#` for comments:

```
data/partners-names/canada.txt
data/partners-names/united_kingdom.txt
data/partners-names/new_zealand.txt
data/partners-names/united_states.txt
data/partners-names/germany.txt
data/partners-names/ireland.txt
data/partners-names/malaysia.txt
data/partners-names/uae.txt
data/partners-names/thailand.txt
```

Then run `bun run partners:discover -- --country canada`, review
`data/partners.review.json`, and re-run with `--apply` to load confident rows into
`kb_partners` (as unverified). Confirm or fix each one with
`PUT /v1/knowledge/partners/:slug` (set `verified: true`), and crawl with
`bun run ingest -- --source partners --country canada`.
