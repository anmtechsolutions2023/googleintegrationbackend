// src/__tests__/fixtures/screens.js
//
// What each Front Desk screen needs, declared once.
//
// This is the machine-readable half of a rule that used to live only in
// people's heads: **a screen offered to a scope must load for that scope.**
// Menu entries and route guards were authored independently and drifted, so a
// waiter was shown the till and then refused the floor plan, the menu, the
// tables and the variants it is made of. Twelve screen/scope combinations were
// broken that way, and no test could see it because each half was correct on
// its own terms.
//
//   shownTo — the scopes that put this screen in the sidebar. MUST mirror
//             FRONT_DESK_NAV in the frontend's src/config/navigation.js. The
//             two live in different repos; when you change one, change both.
//   loads   — every GET the screen fires while rendering, INCLUDING the ones
//             made by components inside it (pickers, modals, dropdowns). A
//             fetch belongs to the screen that displays it, not to the file it
//             is written in.
//   actions — what the screen lets you DO, and the scope each needs. Used to
//             assert the opposite: refused without that scope, admitted with
//             it. The UI must hide these; the server must refuse them anyway.
//
// Adding a screen? Add it here. A screen absent from this file is a screen
// nobody is checking.

const SCREENS = [
  {
    screen: 'Billing & KOT',
    shownTo: ['POS_ORDER:READ'],
    loads: [
      '/api/pos/orders',
      '/api/pos/tables', '/api/pos/floors', '/api/pos/item-meta', '/api/pos/variants',
      '/api/pos/kots',
      '/api/paymentmodes', '/api/itemdetails',
      // The customer picker beside the bill.
      '/api/pos/customers/search',
    ],
    actions: [
      { verb: 'post', path: '/api/pos/orders', needs: 'POS_ORDER:WRITE' },
      { verb: 'post', path: '/api/pos/bills', needs: 'POS_BILLING:WRITE' },
    ],
  },
  {
    screen: 'Tables',
    shownTo: ['POS_ORDER:READ'],
    loads: ['/api/pos/tables', '/api/pos/floors', '/api/pos/orders'],
  },
  {
    screen: 'Kitchen (KDS)',
    shownTo: ['POS_KITCHEN:READ'],
    // The KDS is a list of the orders being cooked, laid out by table.
    loads: ['/api/pos/kots', '/api/pos/orders', '/api/pos/tables'],
  },
  {
    screen: 'Token Queue',
    shownTo: ['POS_OPS:READ'],
    // Each token links through to the order it was issued for.
    loads: ['/api/pos/tokens', '/api/pos/branches', '/api/pos/orders/ORDER_ID/detail'],
    actions: [{ verb: 'post', path: '/api/pos/tokens', needs: 'POS_OPS:WRITE' }],
  },
  {
    screen: 'Customer Display',
    shownTo: ['POS_OPS:READ'],
    loads: ['/api/pos/tokens', '/api/pos/branches'],
  },
  {
    screen: 'Online Orders',
    shownTo: ['POS_OPS:READ'],
    loads: ['/api/pos/online-orders'],
  },
  {
    screen: 'Live Tracking',
    shownTo: ['POS_OPS:READ'],
    loads: ['/api/pos/online-orders'],
  },
  {
    screen: 'Menu Master',
    shownTo: ['POS_CONFIG:READ'],
    loads: [
      '/api/pos/item-meta', '/api/itemdetails', '/api/pos/branches',
      '/api/pos/channels', '/api/pos/food-types', '/api/pos/variants',
    ],
    actions: [{ verb: 'post', path: '/api/pos/item-meta', needs: 'POS_CONFIG:WRITE' }],
  },
  { screen: 'Food Types', shownTo: ['POS_CONFIG:READ'], loads: ['/api/pos/food-types'] },
  { screen: 'Channels',   shownTo: ['POS_CONFIG:READ'], loads: ['/api/pos/channels'] },
  { screen: 'Variants',   shownTo: ['POS_CONFIG:READ'], loads: ['/api/pos/variants'] },
  {
    screen: 'Floors',
    shownTo: ['POS_CONFIG:READ'],
    loads: ['/api/pos/floors', '/api/pos/branches'],
    actions: [{ verb: 'post', path: '/api/pos/floors', needs: 'POS_CONFIG:WRITE' }],
  },
  {
    screen: 'POS Settings',
    shownTo: ['POS_CONFIG:READ'],
    loads: ['/api/pos/settings?branchId=BRANCH_ID', '/api/pos/branches'],
  },
  {
    screen: 'Expenses',
    shownTo: ['POS_OPS:READ'],
    loads: ['/api/pos/expenses', '/api/expense-categories', '/api/paymentmodes', '/api/pos/branches'],
    actions: [{ verb: 'post', path: '/api/pos/expenses', needs: 'POS_OPS:WRITE' }],
  },
  {
    screen: 'Expense Categories',
    // Reachable on approval authority alone — whoever signs spend off decides
    // which account it books to.
    shownTo: ['POS_OPS:READ', 'EXPENSE:APPROVE'],
    loads: ['/api/expense-categories', '/api/accounttypebases'],
  },
  {
    screen: 'Cash Sessions',
    shownTo: ['POS_BILLING:READ', 'POS_BILLING:WRITE'],
    loads: ['/api/pos/cash-sessions', '/api/pos/branches'],
  },
  {
    screen: 'Asset Register',
    shownTo: ['ASSET:READ', 'ASSET:WRITE'],
    loads: ['/api/assets', '/api/assets/summary', '/api/asset-categories', '/api/pos/branches'],
  },
  {
    screen: 'Asset Categories',
    shownTo: ['ASSET:READ', 'ASSET:WRITE'],
    loads: ['/api/asset-categories'],
  },
  {
    screen: 'Customers',
    shownTo: ['POS_CRM:READ'],
    // A customer's history links through to the orders behind it.
    loads: ['/api/pos/customers', '/api/pos/branches', '/api/pos/orders/ORDER_ID/detail'],
    actions: [{ verb: 'post', path: '/api/pos/customers', needs: 'POS_CRM:WRITE' }],
  },
  {
    screen: 'Feedback',
    shownTo: ['POS_CRM:READ'],
    loads: ['/api/pos/feedback', '/api/pos/customers', '/api/pos/branches'],
  },
  {
    screen: 'Reports',
    shownTo: ['POS_REPORTS:READ'],
    loads: ['/api/pos/reports'],
  },
  {
    screen: 'Finance',
    shownTo: ['TRANSACTIONS:READ', 'TRANSACTIONS:WRITE'],
    // Revenue is broken down by venue, which means reading the floor plan.
    loads: ['/api/pos/branches', '/api/pos/floors', '/api/pos/tables', '/api/ledger/reports/overview'],
  },
  {
    screen: 'Ledger',
    shownTo: ['TRANSACTIONS:READ', 'TRANSACTIONS:WRITE'],
    loads: ['/api/ledger/documents', '/api/ledger/reports/sales', '/api/pos/orders/ORDER_ID/detail'],
  },
  {
    screen: 'People & Access',
    shownTo: ['TENANT:ADMIN'],
    loads: ['/api/admin/users', '/api/admin/roles', '/api/admin/features',
      '/api/admin/invitations', '/api/pos/branches'],
  },
];

module.exports = { SCREENS };
