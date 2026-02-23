// routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const pool = require("../config/db");

// Middleware pour protéger certaines pages
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

// Page de login (GET)
router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// Traitement du login (POST)
router.post("/login", async (req, res) => {
  const { email, mot_de_passe } = req.body;

  try {
    const [users] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);

    if (users.length === 0) {
      return res.render("login", { error: "Email introuvable" });
    }

    const user = users[0];

    const match = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!match) {
      return res.render("login", { error: "Mot de passe incorrect" });
    }

    // Stocker l'utilisateur dans la session
    req.session.user = {
      id: user.id,
      nom: user.nom,
      email: user.email,
    };

    res.redirect("/auth/dashboard");
  } catch (err) {
    console.error("Erreur login :", err);
    res.status(500).send("Erreur serveur");
  }
});

// Tableau de bord (protégé)
router.get("/dashboard", requireLogin, (req, res) => {
  res.render("dashboard", { user: req.session.user });
});

// Déconnexion
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
});

module.exports = router;
