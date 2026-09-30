// src/modules/posdine/dine.controller.js
// HTTP layer for the public diner endpoints. Validation in, one service call,
// one response shape out.

const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, createdResponse } = require('../../utils/responseHelper');
const { validateBody, validateParams } = require('../../middleware/validation');
const contextService = require('./dine.context.service');
const authService = require('./dine.auth.service');
const menuService = require('./dine.menu.service');
const orderService = require('./dine.order.service');
const customerService = require('./dine.customer.service');
const {
  tokenParamSchema,
  requestCodeSchema,
  verifyCodeSchema,
  quoteSchema,
  placeOrderSchema,
  nameSchema,
} = require('./dine.schemas');

const resolve = asyncHandler(async (req, res) => {
  const ctx = await contextService.resolve(req.params.token);
  successResponse(res, 'Table found', contextService.toPublic(ctx));
});

const logo = asyncHandler(async (req, res) => {
  const ctx = await contextService.resolve(req.params.token);
  const data = await contextService.getLogo(ctx);
  res.set('X-Content-Type-Options', 'nosniff');
  successResponse(res, data ? 'Logo retrieved' : 'This branch has no logo', data);
});

const requestCode = asyncHandler(async (req, res) => {
  const data = await authService.requestCode(req.params.token, req.body.phone, req.ip);
  successResponse(res, 'A code is on its way on WhatsApp', data);
});

const verifyCode = asyncHandler(async (req, res) => {
  const data = await authService.verifyCode(req.params.token, req.body);
  successResponse(res, 'Number verified', data);
});

const getSession = asyncHandler(async (req, res) => {
  const { settings } = req.diner;
  successResponse(res, 'Session is active', {
    mode: settings.mode, canOrder: settings.canOrder,
  });
});

const setName = asyncHandler(async (req, res) => {
  const { customerId, tenantId, phone } = req.diner;
  const data = await customerService.nameIfGuest(customerId, req.body.name, tenantId, phone);
  successResponse(res, 'Name saved', data);
});

const getMenu = asyncHandler(async (req, res) => {
  const data = await menuService.getMenu(req.diner);
  successResponse(res, 'Menu retrieved', { ...data, canOrder: req.diner.settings.canOrder });
});

const quote = asyncHandler(async (req, res) => {
  const data = await orderService.quote(req.body.items, req.diner);
  successResponse(res, 'Order priced', data);
});

const placeOrder = asyncHandler(async (req, res) => {
  const data = await orderService.place(req.body, req.diner);
  createdResponse(res, 'Order placed — a staff member will confirm it shortly', data);
});

const listOrders = asyncHandler(async (req, res) => {
  const data = await orderService.listMine(req.diner);
  successResponse(res, 'Orders retrieved', data);
});

module.exports = {
  resolve: [validateParams(tokenParamSchema), resolve],
  logo: [validateParams(tokenParamSchema), logo],
  requestCode: [validateParams(tokenParamSchema), validateBody(requestCodeSchema), requestCode],
  verifyCode: [validateParams(tokenParamSchema), validateBody(verifyCodeSchema), verifyCode],
  getSession: [getSession],
  setName: [validateBody(nameSchema), setName],
  getMenu: [getMenu],
  quote: [validateBody(quoteSchema), quote],
  placeOrder: [validateBody(placeOrderSchema), placeOrder],
  listOrders: [listOrders],
};
