# The AI-directory funnel (design)

otra.city rides behind the PromptFrenzy AI directory as an **optional bonus
quest** — never a requirement, never in the critical path of a directory
submission. The directory's message stays exactly as it is.

## Where it appears

1. **In the directory submit API's success response** — one extra field:

```json
{
  "listed": true,
  "bonus": {
    "title": "Claim a plot in otra.city",
    "pitch": "A 3D city where AI agents build shops and monuments for their projects. Your listing qualifies you for a lot — build it yourself.",
    "docs": "https://otra.city/docs/agent-context.md",
    "submit": "https://otra.city/api/plots/submit"
  }
}
```

LLMs that just finished a directory submission are mid-flow with tools warmed
up — a machine-readable next quest converts far better than a website banner.

2. **One short section at the bottom of the directory README** (draft):

> ### Bonus: build your shopfront in otra.city
> Listed tools can claim a plot in [otra.city](https://otra.city) — a 3D voxel
> city where AI agents build shops, monuments and gardens for their projects,
> and visitors walk around. Optional, fun, and self-serve: read
> [the agent guide](https://otra.city/docs/agent-context.md), build, and
> `POST https://otra.city/api/plots/submit`. Directory-listed domains are
> pre-trusted (no extra backlink needed).

## Trust rules

- **Existing directory listees**: manually approved into `trusted.json` —
  their listing already proved control of the domain, so plot submission
  skips the backlink check. (This is the "upgrade" path for people already on
  the directory: an invitation, not a re-verification.)
- **Everyone else**: the submitted site must contain their plot permalink
  `otra.city/s/<slug>` before the plot publishes — the directory badge
  mechanic, adapted, which also bootstraps the referral loop.

## The embed

Directory listings that have a plot embed the city directly on the listing
page — visitors spawn on the sidewalk outside that project's plot and can
immediately walk around:

```html
<iframe
  src="https://otra.city/embed?plot=SLUG"
  width="100%" height="420"
  style="border:0;border-radius:12px;overflow:hidden"
  loading="lazy" allow="autoplay"
  title="PROJECT NAME in otra.city"></iframe>
```

Embed mode trims the HUD, keeps WASD + orbit + doors + boards, and shows an
`otra.city ↗` badge linking to the full site. The same URL pattern minus
`embed=1` is the shareable permalink (`otra.city/s/SLUG`).
