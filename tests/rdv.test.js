const request = require("supertest");
const app = require("../app");

describe("RDV",()=>{

 test("Refuse accès sans connexion", async()=>{

   const response = await request(app)
      .post("/auth/api/rdv-from-calendar")
      .send({
        nom_client:"Julian"
      });

   expect(response.statusCode)
   .not.toBe(200);

 });

 test("Réservation refusée si client non connecté", async () => {
  const response = await request(app)
    .post("/rdv/reserver")
    .send({
      creneau_id: 1,
      type_seance_id: 1,
    });

  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toContain("/client/login");
});

test("API création créneau refusée sans connexion praticien", async () => {
  const response = await request(app)
    .post("/auth/api/creneaux-from-calendar")
    .send({
      start: "2026-06-01T10:00:00",
      end: "2026-06-01T11:00:00",
    });

  expect([302, 401, 403]).toContain(response.statusCode);
});

test("Inscription client refusée avec email invalide", async () => {
  const response = await request(app)
    .post("/client/register")
    .send({
      nom: "Julian",
      email: "aaa",
      telephone: "0600000000",
      mot_de_passe: "12345678",
      mot_de_passe_confirm: "12345678"
    });

  expect(response.text)
    .toContain("Email invalide");
});

test("Inscription refusée si mots de passe différents", async () => {
  const response = await request(app)
    .post("/client/register")
    .send({
      nom: "Julian",
      email: "julian@test.fr",
      telephone: "0600000000",
      mot_de_passe: "12345678",
      mot_de_passe_confirm: "99999999"
    });

  expect(response.text)
    .toContain("Les mots de passe ne correspondent pas");
});

test("Réservation refusée si données incomplètes", async () => {
  const response = await request(app)
    .post("/rdv/reserver")
    .send({});

  expect([302,400,401,403]).toContain(
    response.statusCode
  );
});

test("Mot de passe oublié refuse email invalide", async () => {
  const response = await request(app)
    .post("/client/mot-de-passe-oublie")
    .send({
      email:"aaa"
    });

  expect(response.text)
    .toContain("Email invalide");
});

});