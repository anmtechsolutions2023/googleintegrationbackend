# Duplicate API calls from the app shell and shared code (tenant-auth-ui)

All paths are relative to `/Users/animeshmalhotra/DATA/projects/googleintegrationfrontend/tenant-auth-ui/src` unless noted. Sources are the local files (cited as file:line). This was a code audit; nothing was run.

## Which providers fetch on mount, and do pages also fetch the same endpoint?

### Takeaway
None of the global providers or shell components fetches anything on mount. AuthContext only decodes the cookie, FrontDeskContext does nothing until something calls it, and Navbar, WorkspaceLayout, Rail, Header and Guards make no API calls. The shell-level duplicates come from one shared banner, QrOrderAlert, which is mounted from the workspace config next to pages that poll the same endpoint.

### Cited Findings
- AuthProvider's mount effect only reads the cookie and decodes the JWT. It makes no network call — `context/AuthContext.js:21-32`.
- FrontDeskProvider (mounted by WorkspaceLayout for every workspace screen, `components/workspace/WorkspaceLayout.js:32`) defines `refreshFloors/Tables/Menu/Orders/Kots/Bills/All` but has no useEffect. A grep for `useFrontDesk()/refreshAll/refreshMenu/refreshTables` in pages/components found no callers, so it never fetches and is effectively dead code — `context/FrontDeskContext.js:9-79`.
- OrderLinkProvider has no fetch; its value is memoised — `components/frontdesk/OrderLinkProvider.js:23-27`.
- Navbar, Guards, WorkspaceLayout, WorkspaceRail, WorkspaceHeader, WorkspaceRedirects and SectionedTab only call `useAuth()`. A grep for service, api or useEffect calls found none (the only effect in WorkspaceLayout scrolls to the top, `WorkspaceLayout.js:23-29`).
- BrandMark is an inline SVG with no fetch — `components/BrandMark.js:31-55`.
- **CONFIRMED duplicate: `GET /api/pos/qr/orders/pending`** (`config/config.js:52`, `services/qrService.js:28`).
  - The workspace config puts `banner: 'qrAlert'` on the `/billing` tab and on the `/service/floor` tab — `config/workspaces.js:58,63`. SectionedTab renders `<QrOrderAlert/>` for these tabs — `components/workspace/SectionedTab.js:9-17,32`.
  - QrOrderAlert fetches on mount and then polls every 15 s — `components/frontdesk/QrOrderAlert.js:10,28-37`.
  - **/service/floor/qr (QR inbox):** QrOrders.js also fetches on mount and polls every 15 s — `pages/frontdesk/QrOrders.js:11,178-194`. QrOrderAlert's effect runs even on the inbox; only its render is suppressed (`QrOrderAlert.js:39`, the early `return null` comes after the effect). Result: 2 calls on load and 2 calls every 15 s, for as long as the screen is open. That is production behaviour; in dev it doubles to 4 on load.
  - **/billing (till):** Billing.js has its own poller for the same endpoint (via `posService.getPendingQrOrders` → `qrService.getPendingOrders`, `services/posService.js:183`). It runs on mount and every 15 s — `pages/frontdesk/Billing.js:425-443`. Same result: 2 calls per load and 2 per 15 s.
  - /service/floor/tables: only the banner polls (1 call), so there is no duplicate.

### Inferences
- The two pollers on the same screen are not phase-aligned, so the backend sees about 8 requests a minute per open till or QR inbox screen instead of 4. A restaurant keeps tills open all day, so this is steady load that grows with the number of terminals. Severity: **medium**. The query is cheap, but the load lasts all shift and scales with terminal count.

### Gaps
- I did not measure how expensive the pending-QR query is on the backend.

## Which effects have unstable dependencies (including the user object changing on token refresh)?

### Takeaway
The shared hooks and shell use stable dependencies: primitives, useCallback with primitive deps, or module-level constants. I found no refetch loops. The only effect keyed on the user object is in Forbidden.js, and it uses `user?.tid` (a primitive).

### Cited Findings
- useExports keys on a string built from `tid` and the sorted scopes, plus a boolean `signedIn`. A new user object with the same scopes does not refire it — `hooks/useExports.js:15-28`.
- useBranchMedia depends on `branchId`, `logoPath` and `qrPath` (strings) plus `refreshKey`, not on `shop` — `hooks/useBranchMedia.js:46-72`. Note: it fires one `GET /api/pos/media/:kind` per kind, so up to 2 requests, each time it mounts. The docstring says three screens use it (till print path, Receipt Format preview, Business Profile), and nothing is cached across screens.
- usePosBranch depends only on `[storageKey]` — `hooks/usePosBranch.js:40-63`.
- useOrderQueue: `load` is a useCallback over `[branchId, ready]`. The poll effect depends on `[load, pollMs, ready]` and clears its interval — `hooks/useOrderQueue.js:85-129`.
- useOrderDetail depends on `[orderId]` — `hooks/useOrderDetail.js:20-37`.
- useMenuFilters makes no network calls (pure useMemo/useCallback) — `hooks/useMenuFilters.js`.
- useCan is pure and does no I/O — `hooks/useCan.js:30-37`.
- usePrinter only subscribes locally — `hooks/usePrinter.js:10`.
- A grep for effect deps containing `user` found only `pages/Forbidden.js:41` (`[user?.tid]`).

### Inferences
- Because each of these effects depends only on primitive values, a new user object identity from `setUser(payload)` re-renders consumers but does not refetch through these shared hooks.

### Gaps
- Page-level effects with object or function deps were outside my scope (page-level researchers cover them).

## Which pollers or intervals start more than once, or don't clear?

### Takeaway
Every interval I found is cleared in its effect cleanup. The duplicate polling is the QR pending pair described above, where a layout-level banner and the page both poll.

### Cited Findings
- QrOrderAlert clears its interval — `QrOrderAlert.js:36`.
- QrOrders clears its interval — `QrOrders.js:193`.
- Billing clears its QR poll (`Billing.js:443`) and its 30 s clock (`Billing.js:419-422`). The clock is local only, with no fetch.
- useOrderQueue clears its interval — `useOrderQueue.js:128`.
- React.StrictMode wraps the app — `index.js:8-12`. In development every mount effect runs mount → cleanup → mount, so each fetch-on-mount above fires twice in dev only. Cleanup flags (`alive`, `live`, `cancelled`) stop stale state updates but do not cancel the HTTP request. No AbortController is used anywhere in the shared code I read.

### Inferences
- The StrictMode doubling inflates the counts seen in the dev Network tab. It does not apply to the production build.

### Gaps
- I did not check whether pollers pause when the tab is hidden. I saw no `visibilitychange` handling in the shared hooks or components, so background tabs keep polling.

## Is there any request de-duplication or caching layer, and where is it missing?

### Takeaway
There is no general layer: no React Query, SWR or axios cache. The only de-duplication is a module-level promise cache for the exports catalogue. The most widely repeated shared endpoint, `GET /api/pos/branches`, has no cache and is fetched separately by about 23 pages and components.

### Cited Findings
- The `/api/exports` catalogue is cached as a Map of promises keyed on tenant plus scopes. All Export buttons on a page share 1 request, and failed requests are not cached — `services/exportService.js:36-55`, used by `hooks/useExports.js`, `components/export/ExportButton.js:27` and `ReportsBundleButton.js:22`. Result: 1 call per identity per session, and still 1 in dev because StrictMode's second mount reuses the cached promise.
- The axios instance only has auth and refresh interceptors. It has no cache and no in-flight de-duplication — `api/api.js:8-71`.
- `GET /api/pos/branches` (`services/posService.js:388-391`) has no cache. It is called from 23 files, including PaymentMethods, Campaigns, Returns, QrCodes, AccessControl, BusinessProfile and TokenDisplay (via usePosBranch), Expenses, Portals, Tokens, PosSettings, ReceiptFormat, Billing (`:871`), DailyStock, OnlineOrders, Assets, CashSessions, Finance, WriteOffRegister, ImportDrawer, ExportDialog and ReportsBundleButton.
  - CONFIRMED same-page duplicate: Dues.js renders `<WriteOffRegister/>` (`pages/frontdesk/Dues.js:205`), which fetches branches on mount (`components/frontdesk/WriteOffRegister.js:41-46`). I did not confirm whether Dues itself also fetches branches.
  - ExportDialog (`ExportDialog.js:64-67`) and ReportsBundleButton (`:32-38`) fetch branches again when opened, even on pages that already loaded them. That is one extra call per open, triggered by the user rather than on load.
  - Every navigation between workspace screens refetches branches, because nothing is held in WorkspaceLayout or a context.

### Inferences
- A shared, session-cached `getPosBranches` (a promise cache like the exportService one, invalidated on tenant switch) would remove most repeat traffic to this endpoint. Severity: **low to medium**. The query is small, but it runs on almost every POS screen visit.
- FrontDeskContext is the obvious place for shared POS lookups, but it is unused, so each screen fetches menu, tables and so on for itself.

### Gaps
- I did not count how many pages refetch `getAllItemMeta`, tables or floors per navigation; that is page scope.

## Does a token refresh (TOKEN_REFRESHED_EVENT / applyToken) re-trigger all fetches?

### Takeaway
No. A refresh happens only when the server sees that the user's scopes changed, which is rare. When it does happen it replaces the `user` object but does not remount the shell, and shared fetches are keyed on primitives. The exception is useExports: when the scopes really do change, it refetches `/api/exports` once, by design.

### Cited Findings
- The backend sets `X-Access-Token` only when `!sameScopes(user.scopes, access.scopes)` — `googleintegrationbackend/src/middleware/liveAccess.js:105-117`. It is not set on every response.
- The frontend interceptor dispatches TOKEN_REFRESHED_EVENT for any response that carries the header, including error responses — `api/api.js:28-43`. AuthContext then calls `applyToken` → `setUser(payload)` — `context/AuthContext.js:76-98`. The listener is registered once (`[]` deps) and removed on cleanup.
- Suspected minor issue: until the cookie holding the new token takes effect, requests that were already in flight with the old token each carry the header. A burst of parallel calls (for example a page firing 5 requests) can therefore produce several TOKEN_REFRESHED events and several `setUser` calls, each a full re-render of the tree. These cause re-renders, not refetches, given the primitive deps above.
- `switchTenant` does a hard reload (`window.location.href = ROUTES.DASHBOARD`), so after a tenant switch every fetch runs again by design — `AuthContext.js:118-141`.

### Inferences
- A token refresh does not cause a fetch storm. The cost is extra renders.

### Gaps
- I did not trace whether page-level effects depend on `user` (an object) and would refetch on refresh. Only Forbidden.js matched my grep, and it is safe.

## Summary of findings (severity)
1. **Medium, production, CONFIRMED:** `GET /api/pos/qr/orders/pending` is polled twice in parallel on /billing (QrOrderAlert + Billing.js) and on /service/floor/qr (QrOrderAlert + QrOrders.js). That is 2 calls per load and 2 per 15 s, and 4 per load in dev.
2. **Low to medium, production, CONFIRMED:** `GET /api/pos/branches` has no cache. About 23 call sites fetch it on every screen visit, it is duplicated on the Dues screen (WriteOffRegister), and it is fetched again whenever the export dialog or bundle opens.
3. **Low, dev only:** React.StrictMode (`index.js:9`) doubles every mount fetch in development. The exports catalogue is unaffected because of its promise cache.
4. **Low, production, SUSPECTED:** several parallel responses carrying `X-Access-Token` after a scope change cause repeated `setUser` re-renders, not refetches.
5. Not an issue: AuthContext, FrontDeskContext (unused, never fetches), Navbar, the workspace shell, BrandMark, useCan, useMenuFilters, useExports (de-duplicated).
6. Missing: no app-wide request de-duplication or cache, no AbortController, no pausing of pollers in background tabs.
