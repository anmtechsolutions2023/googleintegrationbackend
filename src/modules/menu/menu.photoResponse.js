// src/modules/menu/menu.photoResponse.js
// Sends a dish photo as the image itself, so an <img> can show it and the
// browser can keep it.
//
// A photo URL carries ?v=<version>, which changes whenever the photo is
// replaced. A versioned request is therefore safe to cache for a year; an
// unversioned one is kept only briefly. Staff copies are `private` (they came
// through a signed-in request); the guest menu's are `public`.

const { MENU_PHOTO } = require('../../config/constants');

/**
 * @param {import('express').Response} res
 * @param {{MimeType: string, Bytes: Buffer, Version: number}} photo
 * @param {{versioned: boolean, shared: boolean}} options
 */
const sendPhoto = (res, photo, { versioned, shared }) => {
  const scope = shared ? 'public' : 'private';
  res.set('Content-Type', photo.MimeType);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', versioned
    ? `${scope}, max-age=${MENU_PHOTO.CACHE_SECONDS}, immutable`
    : `${scope}, max-age=300`);
  res.set('ETag', `"${photo.Version}-${photo.Bytes.length}"`);
  // The app and the API live on different hosts; an image from here must be
  // allowed to render on the app's pages.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.status(200).send(Buffer.from(photo.Bytes));
};

module.exports = { sendPhoto };
