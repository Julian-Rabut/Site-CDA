"use strict";

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}

function requireClientLogin(req, res, next) {
  if (!req.session.client) return res.redirect("/client/login");
  next();
}

module.exports = {
  requireLogin,
  requireClientLogin,
};