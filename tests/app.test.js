const request = require("supertest");
const app = require("../app");

describe("Test serveur", () => {
  test("La page d'accueil redirige correctement", async () => {
    const response = await request(app).get("/");

    expect([200, 302]).toContain(response.statusCode);
  });

  test("Une page inconnue retourne une 404", async () => {
    const response = await request(app).get("/page-inconnue-test");

    expect(response.statusCode).toBe(404);
  });

test("Accès dashboard sans connexion refusé", async () => {
  const response = await request(app).get("/auth/dashboard");

  expect([302,401,403]).toContain(response.statusCode);
});

test("Accès calendrier sans connexion refusé", async () => {
  const response = await request(app).get("/auth/calendar");

  expect([302,401,403]).toContain(response.statusCode);
});
});