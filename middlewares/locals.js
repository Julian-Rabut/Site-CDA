"use strict";

function injectLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.clientSession = req.session.client || null;
  res.locals.publicPage = false;
  next();
}

module.exports = {
  injectLocals,
};