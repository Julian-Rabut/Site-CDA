const bcrypt = require("bcrypt");

async function run() {
  const plainPassword = "Steph0910"; 
  const hash = await bcrypt.hash(plainPassword, 10);
  console.log("Mot de passe en clair :", plainPassword);
  console.log("Hash généré :", hash);
}

run().catch(console.error);
