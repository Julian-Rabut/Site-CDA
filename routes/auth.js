"use strict";

const { body, validationResult } = require("express-validator");
const express = require("express");
const bcrypt = require("bcrypt");

const pool = require("../config/db");

const router = express.Router();

router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post(
  "/login",

  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Email invalide"),

    body("mot_de_passe")
      .isLength({ min: 6 })
      .withMessage("Mot de passe trop court")
  ],

  async (req, res) => {
    try {

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        return res.render("login", {
          error: errors.array()[0].msg
        });
      }

      const { email, mot_de_passe } = req.body;

      const [rows] = await pool.query(
        "SELECT * FROM users WHERE email=?",
        [email]
      );

      if(rows.length===0){
        return res.render("login",{
          error:"Identifiants invalides."
        });
      }

      const user=rows[0];

      const ok=await bcrypt.compare(
        mot_de_passe,
        user.mot_de_passe
      );

      if(!ok){
        return res.render("login",{
          error:"Identifiants invalides."
        });
      }

      req.session.user={
        id:user.id,
        nom:user.nom,
        email:user.email,
        role:user.role
      };

      return res.redirect("/auth/dashboard");

    } catch(err){

      console.error(err);

      return res.render("login",{
        error:"Erreur serveur."
      });

    }
});

router.get("/register", (req, res) => {
  return res.redirect("/auth/login");
});

router.post("/register", (req, res) => {
  return res.redirect("/auth/login");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
});

module.exports = router;