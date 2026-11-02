---
id: CONTENT
title: Site content, information architecture and look
status: implementing
area: site-platform
linear:
  initiative: https://linear.app/sesv/initiative/site-platform-6ac5ff8c3199
  parent: https://linear.app/sesv/project/content-7fffaf789cfa
  document: https://linear.app/sesv/document/spec-003-site-content-information-architecture-and-look-703a7732ce9c
supersedes: []
created: 2026-11-02
---

# CONTENT: Site content, information architecture and look

## 1. Context

https://linear.sesv.co is still the seed's placeholder: a paragraph and three cards that
link out to Linear initiatives. Someone landing there cannot tell what each proposal is,
why it matters, how to try it, how the site itself was made, or who made it.

This spec turns the site into the explanation layer for the proposals. It fixes the
information architecture, the structure of each page and the rules for the look. It does
not fix copy: wording, ordering within a page and visual detail are expected to change
often, and those changes go through pull requests without touching this spec. Only a
change to the pages, their required parts or the styling rules needs a spec edit.

Two things already exist and are reused: sign in with Linear and the `/sheets` guard
(MIRROR-R15, MIRROR-R16), and the shadcn/ui baseline on Tailwind (SEED-R19).

## 2. Goals and non-goals

Goals:

- A landing page that presents the three initiatives, this site and its author in one
  screen or two.
- One page per initiative explaining the problem, the proposal and its status, leading
  into its demo.
- A page on how this site is built, delivered and developed, including how AI is used.
- An about page.
- Pages that anyone can read without signing in. Sign-in is needed only to enter a demo,
  and is available from every page.
- A look styled after Linear's public site, built from open-source parts and without
  Linear's marks. The one exception is a demo library whose licence a decision record
  chooses (section 5, Licences).
- Copy kept in MDX files so that editing it is editing prose.

Non-goals:

- Changing who can sign in. Demo access stays as REC-005 decides: members of the
  workspace, optionally narrowed by an allowlist. Opening demos to outside visitors is a
  later spec if it is wanted.
- Moving demos. Each demo keeps its own top-level path (`/sheets` today); initiative
  pages link to it.
- Final copy. Each page task ships a first draft from the repository's own documents;
  the author rewrites it as often as needed.
- Blog, search, analytics, comments, internationalisation, social preview images.

## 3. Requirements

### Information architecture

- **CONTENT-R1** (e2e) These public routes exist and return 200: `/` (landing),
  `/planning-sheet`, `/metrics-rollup`, `/ai-sdlc` (one per initiative), `/this-site`
  (how the site is built) and `/about`.
- **CONTENT-R2** (e2e) Every public route renders for an anonymous visitor without a
  redirect, is server-rendered and is readable with JavaScript disabled. Sign-in is
  required only on demo routes, which keep the MIRROR-R15 guard.
- **CONTENT-R3** (e2e) Every page, public or demo, shows the same header: the site name
  linking to `/`, navigation to the three initiative pages, `/this-site` and `/about`
  with the current page marked `aria-current="page"`, the theme control (CONTENT-R18)
  and the account control (CONTENT-R4).
- **CONTENT-R4** (e2e) The account control shows a sign-in link to an anonymous visitor
  and the user's name with a sign-out button to a signed-in user. Signing in from any
  page returns the user to that page; signing out returns to the page it was started
  from when that page is public, and to `/` otherwise.
- **CONTENT-R5** (unit) The post-sign-in redirect accepts any same-origin path, not only
  `/sheets`, and still rejects absolute URLs, protocol-relative paths, backslashes,
  control characters and paths over 512 characters.
- **CONTENT-R6** (e2e) At a 375-pixel-wide viewport every page fits without horizontal
  scrolling and the navigation stays reachable, without JavaScript.
- **CONTENT-R7** (e2e) Every page has its own `<title>` and meta description, taken from
  its content file for content pages.
- **CONTENT-R21** (e2e) With JavaScript, following a link from one site page to another
  renders the next page in place, without reloading the document; the header, the
  landing cards and links in the copy all do. Without JavaScript the same links are
  ordinary links. Added in T7.

### Content files

- **CONTENT-R8** (unit) The copy of every content page lives in one MDX file under
  `apps/web/content/`, rendered at build time. Each file exports `meta` with at least
  `title` and `description`; a test fails when a file lacks either.
- **CONTENT-R9** (unit) MDX content can use a fixed set of site components, at least a
  demo link (CONTENT-R12) and a callout, and is rendered with one prose style shared by
  every content page.
- **CONTENT-R10** (check) `.gitattributes` puts `apps/web/content/**` in the
  `review-documentation` category so copy changes group with documentation in Linear
  Diffs.

### Pages

- **CONTENT-R11** (e2e) The landing page shows: a hero with the page's title and a short
  purpose (the site name stays in the header); one card per initiative with its title, a
  one-line summary, a status label and a link to its page; a section about this site with
  the summary `/this-site` exports, linking to it; a short excerpt about the author,
  linking to `/about`; and the footer.
- **CONTENT-R12** (e2e) Each initiative page shows its title, status, the problem and the
  proposal, a demo section, and links to its Linear initiative and to its specs and
  records in the repository. The demo section either links to the demo, saying that it
  needs sign-in with a Linear account of the workspace when the visitor is anonymous, or
  says that no demo is available yet and links nowhere. The planning-sheet page's demo
  section links to `/sheets`.
- **CONTENT-R13** (e2e) `/this-site` has five sections with stable anchors: `#stack`
  (how it is built), `#hosting` (where it runs, with a photo of the hardware),
  `#delivery` (how it is released and deployed), `#process` (specs, records and the
  Linear loop) and `#ai` (how AI is used in the work). It links to the
  repository, `docs/specs`, `docs/records` and `AGENTS.md`.
- **CONTENT-R14** (e2e) `/about` shows the author's name, a captioned photo beside the
  text, a short biography and contact links, with any email address shown as text. The landing excerpt and the about page
  read the excerpt from the same source, so they cannot drift.

### Look

- **CONTENT-R15** (manual) The visual language follows Linear's public site: dark-first
  neutral greys, one desaturated indigo accent, Inter for text, an open-source monospace
  for code, a tight type scale, thin borders and restrained motion. It builds on the
  shadcn/ui tokens and components already in the repository. The sign-in page, the
  not-found page and the demo shells use the same layout and styles as content pages.
- **CONTENT-R16** (check) Every font, icon set and component library the site ships is
  under an open-source licence, except a library a demo uses under a licence that an
  accepted decision record chooses (REC-004 for the planning-sheet grid). Each one is
  listed with its licence in `apps/web/THIRD_PARTY.md`, and an exception names its
  record. No Linear logo, logomark, wordmark or icon file is in the repository, and no
  Linear asset is loaded at runtime, with one exception: Linear's logomark, copied
  unaltered from Linear's brand kit into one component, marks the sign-in controls (the
  header's sign-in link and the sign-in page's button) as signing in with Linear, and
  appears nowhere else.
- **CONTENT-R17** (e2e) The footer on every page states that the site is an independent
  project not affiliated with or endorsed by Linear, next to the version, commit and
  repository link of SEED-R17.
- **CONTENT-R18** (e2e) Theme: the site follows the system preference by default. A
  control in the header sets light, dark or system, stored in a cookie and applied
  during server rendering, so the first paint already uses the chosen theme. The control
  works without JavaScript.
- **CONTENT-R19** (e2e) Loading any public page makes no request to another origin:
  fonts and assets are served by the site itself.
- **CONTENT-R20** (manual) Text and controls meet WCAG 2.2 AA contrast in both themes,
  every interactive element has a visible focus state, and every page can be used with
  the keyboard alone.
- **CONTENT-R22** (unit) Every photo the site shows is committed as WebP under
  `apps/web/content/images`, one file per width its layout needs, none over 100 KB, and
  no unconverted image (PNG, JPEG and the like) is left under `apps/web`. A photo is
  rendered with a `srcset` that lists exactly those widths, `width` and `height` of its
  largest file, alt text and a small inline placeholder, and loads lazily unless it is on
  the first screen. Added in T8.

## 4. Pages

| Path | Page | Required parts | Draft source |
|---|---|---|---|
| `/` | Landing | Hero (title, purpose), initiative cards under "Ideas & Experiments", this-site section, author excerpt | The author, initiative summaries |
| `/planning-sheet` | Planning sheet | Problem, proposal, status, demo (`/sheets`), links | SPEC-002, REC-004, REC-005 |
| `/metrics-rollup` | Metrics rollup | Problem, proposal, status, demo (none yet), links | Initiative description |
| `/ai-sdlc` | AI SDLC | Problem, proposal, status, demo (none yet), links | Initiative description, REC-001 |
| `/this-site` | About this site | `#stack`, `#hosting`, `#delivery`, `#process`, `#ai`, repository links | AGENTS.md, SPEC-001, REC-002, REC-003, `docs/deploy.md`, the author |
| `/about` | About me | Name, captioned photo, biography, contact links | The author |

The initiative's status label is one of Planned, In progress or Live, kept in the page's
`meta` and changed by hand. The planning sheet starts as In progress, the other two as
Planned. Reading it from Linear is a possible later step.

## 5. Design notes

**MDX.** `@mdx-js/rollup` as a Vite plugin compiles `apps/web/content/*.mdx` into React
components; each route imports its file and renders it inside the shared prose layout.
Metadata uses MDX's own `export const meta = { ... }` rather than YAML front matter, which
would need two more remark plugins. Typed with a small `ContentModule` declaration. The
about excerpt is a named export of `about.mdx` (or a sibling file) that the landing page
imports, which is how CONTENT-R14 avoids drift.

**Styling after Linear, not as Linear.** Linear's brand page forbids altering its
graphics, combining them with others, or using them in a way that implies affiliation.
So the site carries its own wordmark (the site name set in type), takes the qualities
of Linear's public site rather than its assets, and says plainly in the footer that it
is independent (CONTENT-R17). The proposals themselves mention Linear by name, which the
brand page allows. Concretely: the shadcn/ui CSS variables get a new neutral scale and
an indigo accent close to Linear's, Inter (SIL OFL) replaces the system font, and a
monospace under the OFL, such as JetBrains Mono or Geist Mono, stands in for the
commercial Berkeley Mono. Font files are committed or come from a `@fontsource` package
and are served by the site (CONTENT-R19). Icons, if any, come from Lucide (ISC), the set
shadcn/ui uses.

**Licences.** The look itself (fonts, icons, components) is open source without
exception. A demo may need a library that is not: the planning-sheet grid is Handsontable
under its non-commercial licence, chosen in REC-004 for this non-commercial,
demonstrative site. Such a library is allowed when an accepted record chooses its licence
and names it; `THIRD_PARTY.md` lists it in its own table with the record id, and the
licence test accepts a non-open-source row only when it cites an accepted record that
names the package. If the record is retired or superseded, the test fails until the
library is replaced or listed under its new licence. The site's own code stays MIT
(REC-003).

**Theme.** The `dark` variant moves from the media query to a `data-theme` attribute on
`<html>`. The root route reads a `theme` cookie (`light`, `dark` or `system`) on the
server and sets the attribute; `system`, or no cookie, leaves it unset and the media
query decides. The control is a small form posting to a theme route that sets the cookie
and redirects back, like the sign-out form, so it needs no JavaScript; with JavaScript
it can update in place.

**Redirect after sign-in.** `safeNext` currently accepts only `/sheets` paths. It widens
to any same-origin path under the same rejection rules (CONTENT-R5). The header's
sign-in link carries the current path as `next`. Sign-out gets a `next` field in its
form and lands there when the path is public.

**What this spec takes over from SEED.** CONTENT-R11 replaces the landing shape of
SEED-R17 (cards now link to initiative pages; the Linear links move onto those pages)
and CONTENT-R15 and CONTENT-R18 replace SEED-R19. The task that lands each change marks
the SEED line `dropped` with a pointer here and moves its test citations. SEED-R17's
footer clause carries over unchanged into CONTENT-R17.

**What this spec takes over from MIRROR.** The landing page belongs to this spec, so the
planning-sheet card of MIRROR-R26 moved here and MIRROR-R26 is dropped. The card is
CONTENT-R11 and links to `/planning-sheet`; the way into the sheets is that page's demo
section, CONTENT-R12. MIRROR keeps the sheets themselves and their guard.

**Links between pages.** A plain `<a href>` reloads the whole document on every click,
which shows as a flicker of the entire page. Internal links render through one
`SiteLink` component that hands page paths to TanStack Router's `Link`, and MDX copy
gets it as its `a` element, so links written in prose behave the same. Server endpoints
(`/auth/...`, `/theme`), links with a query string and other origins stay plain links.
The router still renders an `<a href>`, so without JavaScript nothing changes
(CONTENT-R21).

**Photos.** Sources are converted once, by hand, with `cwebp`, and only the results are
committed; no image tooling enters the build. `src/images.ts` names each photo with its
widths, intrinsic size, alt text and a tiny WebP placeholder inlined as a data URL, which
the browser upscales into a blur behind the image until it loads. `Photo` renders one;
copy uses it through `Figure`. A unit test reads each file's real size from its WebP
header, so the `srcset` and the reserved space cannot drift from the files (CONTENT-R22).

**Navigation on small screens.** A `<details>`/`<summary>` menu collapses the navigation
below the large breakpoint (1024 pixels, where the five labels and the account control
stop fitting on one row), which keeps it usable without JavaScript (CONTENT-R6).

## 6. Validation

- Unit (Vitest): `safeNext` cases, content `meta` presence for every file in
  `apps/web/content/`, MDX components available to content.
- End to end (Playwright, `local` project): every public route anonymous and with
  JavaScript disabled, header and `aria-current`, sign-in round trip with the `signIn`
  fixture returning to the starting page, sign-out landing, narrow viewport, titles and
  descriptions, landing sections, initiative demo states anonymous and signed in,
  `/this-site` anchors and links, about page and landing excerpt, footer disclaimer,
  theme cookie applied at first render, no cross-origin requests.
- Checks: `.gitattributes` category; a test or script that fails when
  `apps/web/THIRD_PARTY.md` misses a shipped font or library, when a listed licence is
  neither open source nor chosen by an accepted record that names the package, or when a
  file named or shaped like a Linear mark appears under `apps/web`.
- Manual: the look against linear.app in both themes, contrast and keyboard use, and
  reading every page on a phone.

Order of work. The shell first so every later page lands in its final frame, then the
styling so content is written against the real look, then the pages.

## 7. Tasks

- [ ] T1 Site shell: header with navigation and account control, redirect after sign-in
      and sign-out, MDX pipeline and prose layout, public routes with placeholder copy,
      titles and descriptions, narrow-viewport menu, review category
      (R1 to R10)
- [ ] T2 Styling after Linear with open-source parts: tokens, fonts, theme control and
      cookie, footer disclaimer, third-party licence list, restyled sign-in, not-found
      and demo shells, no cross-origin requests (R15 to R20)
- [ ] T3 Landing page (R11, R14)
- [ ] T4 Initiative pages for the planning sheet, metrics rollup and AI SDLC (R12)
- [ ] T5 This site page (R13)
- [ ] T6 About page (R14)
- [ ] T7 Client-side navigation between site pages (R21)
- [ ] T8 Landing hero, Ideas & Experiments, page labels, self-hosted section and photos
      (R11, R13, R14, R22)

## 8. Open questions

1. Resolved at approval: the page about the site lives at `/this-site`.
2. Resolved at approval: the about page has no photo. T6 ships placeholder text for the
   biography, marked as such; the author writes it later through ordinary copy changes.
   Contact links are chosen in T6. Revised in T8: the author supplied a photo, shown with
   a caption beside the text on `/about`.
3. Resolved at approval: the monospace face, JetBrains Mono or Geist Mono, is picked in
   T2 on visual grounds.
4. Resolved at approval: listing the specs and records with their statuses on
   `/this-site`, read from `docs/` at build time, is a follow-up outside this spec's
   tasks, tracked as [LIN-33](https://linear.app/sesv/issue/LIN-33).

## 9. Decisions

- Copy is authored in MDX, one file per page (section 5). Plain Markdown with layout in
  TSX and copy kept in TSX were the alternatives; MDX keeps prose reviewable as prose and
  still lets pages embed site components, for the cost of one build dependency.
- Demos keep their own paths; initiative pages link to them.
- Theme follows the system with a cookie-backed override applied on the server.
- Demo access stays as REC-005 decides.
- T8, 2026-11-02: the landing title is "Cover Letter to Linear", with "Linear" set in the
  site's own type. An inline Linear logo in the title was considered and rejected: as the
  page's headline it would read as Linear's branding of the site, the affiliation Linear's
  brand page forbids implying. The cards sit under "Ideas & Experiments" rather than
  "Proposals"; the navigation reads "About this site" and "About me".
- CONTENT-R16 amended on 2026-11-02, during T8: the sign-in controls carry Linear's
  logomark, because signing in here is signing in with a Linear account. The brand page
  accepts the logomark for referring to Linear as a company where a compact, chip-like
  design is needed, and asks that it not be altered, combined with other graphics or used
  to imply an affiliation. So the mark is the single-colour one from the brand kit,
  unaltered (white, on the accent colour), next to the words "Sign in", only on the two
  sign-in controls; the footer disclaimer stays. A test pins the path to one component
  and its use to those controls.
- CONTENT-R16 amended on 2026-11-02, during T2: as approved it required everything the
  site ships to be open source, but MIRROR T7 had already shipped Handsontable under the
  non-commercial licence that REC-004 accepted. The requirement now allows a demo library
  whose licence an accepted record chooses and names, listed with that record in
  `THIRD_PARTY.md`. Replacing the grid to keep the original wording was rejected: REC-004
  weighed that cost already, and its exit through the grid adapter stays open.

## 10. References

- Linear brand guidelines: https://linear.app/brand
- MDX with Vite and Rollup: https://mdxjs.com/packages/rollup/
- shadcn/ui theming: https://ui.shadcn.com/docs/theming
- Inter: https://rsms.me/inter/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
