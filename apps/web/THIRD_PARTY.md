# Third-party software shipped by the site

Every font, icon set and library whose code or files the site serves or runs, with its
licence (CONTENT-R16). `apps/web/test/third-party.test.ts` fails when a runtime
dependency, a package imported by `src/` (stylesheet imports included) or a vendored set
below is missing here, or when a listed licence is not the one the package declares.
Everything is open source except what a demo uses under a licence an accepted decision
record chooses; that row names the record.

The site carries no Linear logo, wordmark or icon and loads no Linear asset, except
Linear's logomark, unaltered, on the sign-in controls (CONTENT-R16). It is styled after
Linear's public site with the parts below, and its footer says it is an independent
project.

## Fonts

| Name | Package | Licence | Source |
| -- | -- | -- | -- |
| Inter | `@fontsource-variable/inter` | OFL-1.1 | https://rsms.me/inter/ |
| Geist Mono | `@fontsource-variable/geist-mono` | OFL-1.1 | https://github.com/vercel/geist-font |

## Icons and components

| Name | Package | Licence | Source |
| -- | -- | -- | -- |
| Lucide (icons inlined in `src/components/icons.tsx`) | vendored | ISC | https://lucide.dev |
| shadcn/ui (components copied into `src/components/ui`) | vendored | MIT | https://ui.shadcn.com |

## Marks used by reference

| Name | Package | Licence | Source |
| -- | -- | -- | -- |
| Linear logomark (`src/components/linear-mark.tsx`, sign-in controls only, unaltered) | vendored | Linear brand guidelines; proprietary to Linear | https://linear.app/brand |

## Demo libraries under a recorded licence

| Name | Package | Licence | Source |
| -- | -- | -- | -- |
| Handsontable (the planning-sheet grid) | `handsontable` | Non-commercial licence, REC-004 | https://handsontable.com |
| Handsontable React wrapper | `@handsontable/react-wrapper` | Non-commercial licence, REC-004 | https://handsontable.com |

## Libraries

| Name | Package | Licence | Source |
| -- | -- | -- | -- |
| React | `react` | MIT | https://react.dev |
| React DOM | `react-dom` | MIT | https://react.dev |
| TanStack Router | `@tanstack/react-router` | MIT | https://tanstack.com/router |
| TanStack Start | `@tanstack/react-start` | MIT | https://tanstack.com/start |
| srvx | `srvx` | MIT | https://srvx.h3.dev |
| Postgres.js (server only) | `postgres` | Unlicense | https://github.com/porsager/postgres |
| class-variance-authority | `class-variance-authority` | Apache-2.0 | https://cva.style |
| clsx | `clsx` | MIT | https://github.com/lukeed/clsx |
| tailwind-merge | `tailwind-merge` | MIT | https://github.com/dcastil/tailwind-merge |
| Tailwind CSS (compiled into the stylesheet) | `tailwindcss` | MIT | https://tailwindcss.com |
| tw-animate-css (compiled into the stylesheet) | `tw-animate-css` | MIT | https://github.com/Wombosvideo/tw-animate-css |
