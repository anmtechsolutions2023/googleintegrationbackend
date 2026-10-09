# Duplicate API calls: Front Desk / POS pages (frontend code audit)

Paths are relative to tenant-auth-ui/src. Every finding comes from reading the code. "Confirmed" means the code path is unambiguous. "Suspected" means it depends on runtime state. No files were modified.

## Billing.js load(): which endpoints, and does anything else fetch them too?

### Takeaway
Billing mount fires about 13 GETs plus N menu pages. FrontDeskContext fetches nothing (refreshAll is never called), so it does not duplicate them. One endpoint is duplicated by a sibling component: GET /api/pos/qr/pending, polled by both Billing and the QrOrderAlert banner every 15s. The bigger cost is that every action re-runs the entire load().

### Cited Findings
- CONFIRMED: Billing.js:303-384 load() runs, in parallel: GET tables(limit 100), floors(100), item-meta (every page, sequentially, 100 per page, through getAllItemMeta, posService.js:75), orders(limit 100, includes CLOSED orders that are then filtered out client-side at :347), variants, kots(100), payment-modes, addon-groups, addons, /api/pos/orders/waiters. 10 calls plus ceil(menu/100)-1 extra pages. Severity: medium (it is one load, but see the reload finding below).
- CONFIRMED (fallback): Billing.js:358-375 does an N+1 GET /api/itemdetails/:id for each menu row that has no ItemName. Normally 0 calls; the comment says it was 51 calls before the join fix. Severity: low now, high if the join regresses.
- CONFIRMED DUPLICATE: Billing.js:425-444 polls posService.getPendingQrOrders (GET qr pending, qrService.js:28) every 15s. The /billing tab also has `banner: 'qrAlert'` (config/workspaces.js:58), rendered by SectionedTab.js:32, and QrOrderAlert.js:28-37 polls the same endpoint every 15s. Result: 2 identical calls on mount and 2 every 15s (8/min) for as long as the till is open. Severity: medium.
- CONFIRMED: separate mount effects call GET pos branches (Billing.js:867-879), branch payment methods (:896-920, per activeBranchId), pos settings (:925-940, per activeBranchId), and receipt format via usePrintReceipt (receipt/usePrintReceipt.js:102-115). The receipt format is refetched every 10 min and on every window focus (FORMAT_TTL_MS :37). Each runs once; none is duplicated. getPosBranches is also fetched separately by usePosBranch, CashSessions, Finance, Returns and so on, but on different pages, so there is no in-page duplicate. Low.
- CONFIRMED: FrontDeskContext (context/FrontDeskContext.js) wraps the workspace (WorkspaceLayout.js:32), but nothing calls useFrontDesk/refreshAll. It is dead code and causes no duplicate calls. If it is ever wired up alongside Billing's own load, it would double the 6 lists.

## Which calls fire repeatedly after interactions, and are they debounced or deduped?

### Takeaway
The cart pricing quote is NOT debounced. Every cart change fires POST quote twice: once immediately, and again after the debounced offers preview lands and changes effectiveCartDiscounts. Every order, KOT, transfer, delete or settle triggers a full load(), which is 10+ list GETs.

### Cited Findings
- CONFIRMED, HIGH: Billing.js:756-796 posService.quotePricing (POST /api/pos pricing quote, posService.js:912) runs in a useEffect on [cartItems, effectiveCartDiscounts] with no setTimeout or debounce. Each + tap fires 1 quote. Then the offers effect (:698-732, POST offers preview, debounced 350ms) calls setCartOffers(res) with a new object, which recomputes effectiveCartDiscounts (:745-749, a new object every time) and fires a 2nd quote for the same cart, even when no offer applies. Six quick taps give about 6 quotes plus 1 preview plus 1 quote, so roughly 8 calls. Each tap also adds 1 quote that is later cancelled client-side but still hits the server.
- CONFIRMED, MEDIUM: settle modal. Opening it fires previewOffers (:1117-1135, 200ms debounce), then quotePricing (:1163-1180, 250ms debounce). A 2nd quote follows when settleOffers arrives, because effectiveSettleLines changes. Expect 1 preview and 1-2 quotes per open. printProvisionalBill (:1716-1728) calls previewOffers and quotePricing AGAIN for the same lines, even if the modal has already quoted. checkOffers (:1962-1976) re-previews the cart the live effect has already previewed. Severity: low-medium.
- CONFIRMED, HIGH: full `await load()` after deleteOrder (:1474), createOrder (:1521), create+fire (:1580), transfer and undo (:1594, :1619), fireKot (:1654), settle (:1921) and CollectFlow onChanged (:3432). Each action re-fetches all 10 lists plus every item-meta page plus the waiters list, even though only orders/kots/tables changed. Menu, variants, addons, addon-groups, payment-modes and waiters are static during a shift.
- CONFIRMED: table select (:1357-1384) does GET orders?tableId&openOnly=true, 1 call per select. That is reasonable and is merged into state. But after create order, load() and this effect can both run if selectedTable changes, which gives 2 order GETs (suspected).
- CONFIRMED: settle (:1859) runs PUT /api/pos/orders/:id {Status: closed} once per round in Promise.all. That is an N+1 write per table session. Low-medium.
- OK: CustomerPicker.js:31-45 search is debounced. Dine quote (pages/dine/DineApp.js:181-197) is debounced 300ms with sequence guards.

## Any per-row (N+1) request patterns?

### Takeaway
There are four N+1 patterns: the item-detail fallback in Billing, round-closing on settle, portal-branches on Online Orders, and branch media on Business Profile.

### Cited Findings
- Billing.js:365 GET itemdetail per unnamed menu row. Confirmed code; normally 0 calls.
- Billing.js:1859 PUT order per round on settle. Confirmed.
- OnlineOrders.js:123-135 loadMappings: GET portals, then GET portal branches once per portal. Confirmed. Low (there are few portals).
- BusinessProfile.js:205 and hooks/useBranchMedia.js:60: GET branch media once per kind (logo, QR, etc.). Confirmed. Low.
- getAllItemMeta (posService.js:75) pages sequentially, which is N/100 serial requests. It runs on every Billing load and reload.

## Kitchen display and QR alert polling: intervals and duplicates across components

### Takeaway
Kitchen re-pulls three full lists every 15s, including all orders. The QR pending endpoint is double-polled wherever the qrAlert banner sits above a page that polls it itself (Billing, QR inbox). No poller pauses when the tab is hidden.

### Cited Findings
- CONFIRMED, MEDIUM-HIGH: Kitchen.js:57-86 polls GET kots(100), orders(100, all statuses) and tables(100) every 15s, which is 12 list queries/min per KDS screen. Orders and tables are only used for labels, so they do not need polling. There is no visibilitychange pause.
- CONFIRMED DUPLICATE, MEDIUM: on the Floor > QR inbox section, QrOrders.js:177-194 polls GET qr pending every 15s, and the Floor tab banner QrOrderAlert (workspaces.js:63 banner qrAlert) polls the same endpoint every 15s. The banner only hides its output on that path (QrOrderAlert.js:40) and still fetches. Result: 2 calls per 15s. The same duplicate happens on Billing (above).
- CONFIRMED: Floor > Tables (Tables.js:33-55) loads once, with no poll, plus the banner poll. Note: getFloors()/getTables() there pass no limit, so they get the API default page of 10. That is a bug, not a duplicate.
- Others: Tokens.js:71 polls every 15s, TokenDisplay.js:52 every 5s (frequent, meant for a public display), useOrderQueue.js:18/127 every 10s for online orders, and Dine status every POLL_MS (DineApp.js:214-221, only on the status step). None are duplicated across components.
- OK: Dues.js:90 search is debounced 250ms. Finance, Returns, CashSessions, Ledger, PaymentMethods, DailyStock, PortalMenu and QrCodes each fetch their lists once per load or filter change. Ledger.js:133 fetches getDues alongside the documents (a separate endpoint). No duplicates found.

## Severity ranking
1. HIGH: undebounced cart quote, double-fired via effectiveCartDiscounts (Billing.js:756-796).
2. HIGH: full load() (10+ lists, all menu pages) after every till action.
3. MED-HIGH: Kitchen 3-list poll every 15s, including all orders.
4. MEDIUM: QR pending double-polled (Billing or QrOrders, plus QrOrderAlert banner).
5. LOW-MED: duplicate preview/quote on provisional bill and settle; N+1 order close; orders fetched with closed rows and filtered client-side (the backend supports openOnly, posorder.schemas.js:76).
