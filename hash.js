const bcrypt = require("bcrypt");

async function run() {
  const plainPassword = "test123"; // tu peux changer si tu veux un autre mot de passe
  const hash = await bcrypt.hash(plainPassword, 10);
  console.log("Mot de passe en clair :", plainPassword);
  console.log("Hash généré :", hash);
}

run().catch(console.error);
