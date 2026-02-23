document.addEventListener("DOMContentLoaded", function () {
  const calendarEl = document.getElementById("calendar");
  // Contiendra les types de séance chargés depuis l'API
  let TYPES_SEANCE = [];
  let CURRENT_RDV_EVENT = null;

  if (!calendarEl) {
    console.error("Impossible de trouver #calendar");
    return;
  }

  console.log("FullCalendar dispo ?", typeof FullCalendar);

  // ---------- ACTIONS RAPIDES (boutons) ----------
  const btnGenerateDay = document.getElementById("btn-generate-day");
  const btnBlockDay = document.getElementById("btn-block-day");
  const btnDupliquerJournee = document.getElementById("btn-dupliquer-journee");

  

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }
    return data;
  }

  let cachedClients = null;

  async function loadClientsOnce() {
    if (cachedClients) return cachedClients;
    const res = await fetch("/auth/api/clients");
    const data = await res.json();
    cachedClients = (data && data.success && Array.isArray(data.clients)) ? data.clients : [];
    return cachedClients;
  }

  async function setupClientSelectCalendar() {
    const sel = document.getElementById("clientSelectCalendar");
    if (!sel) return;

    const clients = await loadClientsOnce();
    // reset options
    sel.innerHTML = `<option value="">— Nouveau client —</option>`;
    clients.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.nom_client || "";
      opt.textContent = `${c.nom_client || ""}${c.email_client ? " — " + c.email_client : ""}${c.tel_client ? " — " + c.tel_client : ""}`;
      opt.dataset.email = c.email_client || "";
      opt.dataset.tel = c.tel_client || "";
      sel.appendChild(opt);
    });

    sel.onchange = () => {
      const opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value) return;
      inputCreneauNom.value = opt.value || "";
      inputCreneauEmail.value = opt.dataset.email || "";
      inputCreneauTel.value = opt.dataset.tel || "";
    };
  }

  function askDateYYYYMMDD() {
    const d = prompt("Quelle date ? (format YYYY-MM-DD)");
    if (!d) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alert("Format attendu: YYYY-MM-DD");
      return null;
    }
    return d;
  }

  function askTime(label, defaultValue) {
    const t = prompt(`${label} (HH:mm)`, defaultValue || "08:00");
    if (!t) return null;
    if (!/^\d{2}:\d{2}$/.test(t)) {
      alert("Format attendu: HH:mm");
      return null;
    }
    return t;
  }

  function askNumber(label, defaultValue, minValue) {
    const raw = prompt(label, String(defaultValue));
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    if (isNaN(n) || (minValue != null && n < minValue)) {
      alert("Nombre invalide");
      return null;
    }
    return n;
  }

  if (btnGenerateDay) {
  btnGenerateDay.addEventListener("click", () => {
    window.location.href = "/auth/journee/generer";
  });
}

if (btnBlockDay) {
  btnBlockDay.addEventListener("click", () => {
    window.location.href = "/auth/journee/bloquer";
  });
}

if (btnDupliquerJournee) {
  btnDupliquerJournee.onclick = () => {
    window.location.href = "/auth/dupliquer-journee";
  };
}


  // ---------- MODALES ----------

  const modalRDV = document.getElementById("modal-rdv");
  const btnRDVClose = document.getElementById("modal-rdv-fermer");
  const btnRDVAnnuler = document.getElementById("modal-rdv-annuler");
  const btnRDVModifier = document.getElementById("modal-rdv-modifier");

  if (btnRDVModifier) {
    btnRDVModifier.addEventListener("click", () => {
      if (!CURRENT_RDV_EVENT) return;
      const rdvId = String(CURRENT_RDV_EVENT.id).includes("-")
        ? String(CURRENT_RDV_EVENT.id).split("-")[1]
        : String(CURRENT_RDV_EVENT.id);

      window.location.href = `/auth/rdv/${rdvId}/modifier`;
    });
  }


  const spanRDVClient = document.getElementById("modal-rdv-client");
  const spanRDVEmail = document.getElementById("modal-rdv-email");
  const spanRDVTel = document.getElementById("modal-rdv-tel");
  const spanRDVType = document.getElementById("modal-rdv-type");
  const spanRDVStart = document.getElementById("modal-rdv-start");
  const spanRDVEnd = document.getElementById("modal-rdv-end");
  const spanRDVCommentaire = document.getElementById("modal-rdv-commentaire");
  const rdvEditZone = document.getElementById("rdv-edit-zone");
  const rdvEditDate = document.getElementById("rdv-edit-date");
  const rdvEditTime = document.getElementById("rdv-edit-time");
  const btnSaveRdvDatetime = document.getElementById("btn-save-rdv-datetime");
  const btnCancelRdvDatetime = document.getElementById("btn-cancel-rdv-datetime");
  const rdvEditError = document.getElementById("rdv-edit-error");

  // --- Edition RDV depuis la modale ---
if (btnRDVModifier && rdvEditZone) {
  btnRDVModifier.addEventListener("click", () => {
    if (rdvEditError) rdvEditError.textContent = "";
    rdvEditZone.style.display = "block";
  });
}

if (btnCancelRdvDatetime && rdvEditZone) {
  btnCancelRdvDatetime.addEventListener("click", () => {
    if (rdvEditError) rdvEditError.textContent = "";
    rdvEditZone.style.display = "none";
  });
}

if (btnSaveRdvDatetime) {
  btnSaveRdvDatetime.addEventListener("click", async () => {
    try {
      if (!CURRENT_RDV_EVENT) return;

      const event = CURRENT_RDV_EVENT;
      const rdvId = String(event.id).includes("-") ? String(event.id).split("-")[1] : String(event.id);

      const dateVal = rdvEditDate ? rdvEditDate.value : "";
      const timeVal = rdvEditTime ? rdvEditTime.value : "";

      if (!dateVal || !timeVal) {
        if (rdvEditError) rdvEditError.textContent = "Date/heure manquante.";
        return;
      }

      const newStart = new Date(`${dateVal}T${timeVal}:00`);
      if (isNaN(newStart.getTime())) {
        if (rdvEditError) rdvEditError.textContent = "Date/heure invalide.";
        return;
      }

      const res = await fetch(`/auth/api/rdv/${rdvId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: newStart.toISOString() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        console.log("MOVE RDV RESPONSE:", data);
        if (rdvEditError) rdvEditError.textContent = (data && data.error) ? data.error : "Erreur lors de la modification.";
        return;
      }

      // met à jour l’affichage + recharge depuis serveur
      event.setStart(newStart);
      if (rdvEditZone) rdvEditZone.style.display = "none";
      if (calendar) calendar.refetchEvents();
    } catch (e) {
      console.error(e);
      if (rdvEditError) rdvEditError.textContent = "Erreur serveur.";
    }
  });
}



  const modalCreneau = document.getElementById("modal-creneau");
  const formCreneau = document.getElementById("form-creneau");
  const inputMode = document.getElementById("creneau-mode");
  const inputCreneauId = document.getElementById("creneau-id");
  const inputDateIso = document.getElementById("creneau-date-iso");
  const inputDateAffiche = document.getElementById("creneau-date-affiche");
  const inputHeureDebut = document.getElementById("creneau-heure-debut");
  const inputDuree = document.getElementById("creneau-duree");

  const blocChoixAction = document.getElementById("creneau-choix-action");
  const blocRdvFields = document.getElementById("creneau-rdv-fields");

  const inputCreneauNom = document.getElementById("creneau-nom");
  const inputCreneauEmail = document.getElementById("creneau-email");
  const inputCreneauTel = document.getElementById("creneau-tel");
  const selectCreneauType = document.getElementById("creneau-type-id");
  const typeColorPreview = document.getElementById("creneau-type-couleur");

  const btnModalCreneauSupprimer = document.getElementById("modal-creneau-supprimer");
  const btnModalCreneauFermer = document.getElementById("modal-creneau-fermer");
  const btnModalCreneauLiberer = document.getElementById("modal-creneau-liberer");

  const modalCreneauTitre = document.getElementById("modal-creneau-title") || document.getElementById("modal-creneau-titre");
  const modalCreneauSousTitre = document.getElementById("modal-creneau-subtitle") || document.getElementById("modal-creneau-sous-titre");

  const labelActionCreerCreneau = document.getElementById("label-action-creer-creneau");
  const labelActionCreerRDV = document.getElementById("label-action-creer-rdv");

  function openModalRDV() {
    if (modalRDV) modalRDV.classList.remove("hidden");
  }
  function closeModalRDV() {
    if (modalRDV) modalRDV.classList.add("hidden");
  }

  function openModalCreneau() {
    if (modalCreneau) modalCreneau.classList.remove("hidden");
  }
  function closeModalCreneau() {
    if (modalCreneau) modalCreneau.classList.add("hidden");
  }

  if (btnRDVClose) {
    btnRDVClose.addEventListener("click", closeModalRDV);
  }

  if (btnModalCreneauFermer) {
    btnModalCreneauFermer.addEventListener("click", closeModalCreneau);
  }

  // ---------- TYPES DE SÉANCE (API) ----------

  // Remplit la liste déroulante avec TYPES_SEANCE
  function remplirSelectTypes() {
    if (!selectCreneauType) return;

    // On réinitialise la liste
    selectCreneauType.innerHTML = '<option value="">— choisir un type —</option>';

    TYPES_SEANCE.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = String(t.id);
      opt.textContent = t.nom;
      selectCreneauType.appendChild(opt);
    });
  }

  // Charger les types de séance depuis l'API
  function loadTypesSeance() {
    fetch("/auth/api/types-seance")
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) {
          console.error("Erreur chargement types de séance :", data.error);
          return;
        }
        TYPES_SEANCE = data.types || [];
        console.log("Types de séance chargés depuis l'API :", TYPES_SEANCE);
        remplirSelectTypes();
      })
      .catch((err) => {
        console.error("Erreur réseau /auth/api/types-seance :", err);
      });
  }

  // Quand on choisit un type → on met la durée + (optionnel) on montre une couleur
  if (selectCreneauType) {
    selectCreneauType.addEventListener("change", () => {
      const id = selectCreneauType.value;
      const t = TYPES_SEANCE.find((x) => String(x.id) === String(id));

      if (t && t.duree_minutes) {
        inputDuree.value = String(t.duree_minutes);
      }

      if (typeColorPreview) {
        if (t && t.couleur) {
          typeColorPreview.style.backgroundColor = t.couleur;
        } else {
          typeColorPreview.style.backgroundColor = "#f9fafb";
        }
      }
    });
  }

  // On charge les types dès le début
  loadTypesSeance();

  // ---------- AFFICHAGE / MASQUAGE DES CHAMPS RDV ----------

  function updateCreneauActionFields() {
    const actionRadio = document.querySelector("input[name='creneau-action']:checked");
    const action = actionRadio ? actionRadio.value : "creer_creneau";
    if (action === "creer_rdv") {
      blocRdvFields.classList.remove("hidden");
    } else {
      blocRdvFields.classList.add("hidden");
    }
  }

  function handleEventClick(event) {
    const props = event.extendedProps || {};
    const id = event.id || "";

    if (props.type === "rdv" || id.startsWith("r-")) {
      openRDVModal(event);
      return;
    }

    if (props.type === "creneau" || id.startsWith("c-")) {
      openCreneauModalFromEvent(event);
      return;
    }
  }


  document
    .querySelectorAll("input[name='creneau-action']")
    .forEach((r) => r.addEventListener("change", updateCreneauActionFields));

  // ---------- CALENDRIER ----------

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "timeGridWeek",
    locale: "fr",
    firstDay: 1,
    nowIndicator: true,
    allDaySlot: false,
    slotMinTime: "06:00:00",
    slotMaxTime: "23:00:00",
    expandRows: true,
    height: "auto",
    selectable: true,
    selectMirror: true,
    unselectAuto: true,

    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: ""
    },

    editable: true,
    eventDurationEditable: false,

    events: "/auth/api/events",

    dateClick(info) {
      openSlotModalFromDate(info.date);
    },
    

    eventClick: function(info) {
      handleEventClick(info.event);
    },

    eventDrop(info) {
      const id = info.event.id || "";

      // Déplacer un RDV
      if (id.startsWith("r-")) {
        const ok = window.confirm("Déplacer ce rendez-vous à ce nouvel horaire ?");
        if (!ok) return info.revert();
        return handleMoveRdv(info);
      }

      // Déplacer un créneau libre / bloqué
      if (id.startsWith("c-")) {
        const props = info.event.extendedProps || {};
        if (props.statut !== "libre") return info.revert();

        const ok = window.confirm("Déplacer ce créneau à ce nouvel horaire ?");
        if (!ok) return info.revert();
        return handleMoveCreneau(info);
      }

      info.revert();
    }
  });

  calendar.render();
  console.log("Calendrier rendu");

  async function handleMoveCreneau(info) {
    const id = (info.event.id || "").replace("c-", "");
    try {
      await postJSON(`/auth/api/creneaux/${id}/move`, {
        start: info.event.start.toISOString(),
        end: info.event.end.toISOString(),
      });
    } catch (e) {
      alert(e.message);
      info.revert();
    }
  }


  // ---------- SLOT DEPUIS CLIC VIDE ----------

  function openSlotModalFromDate(date) {
    if (!modalCreneau) return;

    const base = new Date(date);

    inputMode.value = "fromClick";
    inputCreneauId.value = "";
    btnModalCreneauSupprimer.classList.add("hidden");

    blocChoixAction.classList.remove("hidden");
    blocRdvFields.classList.add("hidden");
    updateCreneauActionFields();

    if (labelActionCreerCreneau) {
      labelActionCreerCreneau.textContent = "Créer un créneau libre";
    }
    if (labelActionCreerRDV) {
      labelActionCreerRDV.textContent = "Créer un rendez-vous";
    }

    const radioCreer = document.querySelector(
      "input[name='creneau-action'][value='creer_creneau']"
    );
    const radioRDV = document.querySelector(
      "input[name='creneau-action'][value='creer_rdv']"
    );
    if (radioCreer) radioCreer.checked = true;
    if (radioRDV) radioRDV.checked = false;

    inputDateIso.value = base.toISOString();
    inputDateAffiche.value = base.toLocaleDateString("fr-FR", {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    const h = String(base.getHours()).padStart(2, "0");
    const m = String(base.getMinutes()).padStart(2, "0");
    inputHeureDebut.value = `${h}:${m}`;
    inputDuree.value = "60";

    inputCreneauNom.value = "";
    inputCreneauEmail.value = "";
    inputCreneauTel.value = "";
    if (selectCreneauType) {
      selectCreneauType.value = "";
      if (typeColorPreview) typeColorPreview.style.backgroundColor = "#f9fafb";
    }

    modalCreneauTitre.textContent = "Nouveau créneau / RDV";
    modalCreneauSousTitre.textContent =
      "Tu peux créer un créneau libre ou un rendez-vous directement.";

    openModalCreneau();
    setupClientSelectCalendar();


  }

  // ---------- CRENEAU EXISTANT ----------

  function openCreneauModalFromEvent(event) {
    if (!modalCreneau) return;

    const props = event.extendedProps || {};
    const statut = props.statut || "";
    const creneauId = String(event.id).split("-")[1];

    inputMode.value = "fromCreneau";
    inputCreneauId.value = creneauId;

    const start = event.start;
    inputDateIso.value = start.toISOString();
    inputDateAffiche.value = start.toLocaleDateString("fr-FR", {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    const h = String(start.getHours()).padStart(2, "0");
    const m = String(start.getMinutes()).padStart(2, "0");
    inputHeureDebut.value = `${h}:${m}`;

    const end = event.end || new Date(start.getTime() + 60 * 60000);
    const duree = Math.max(5, Math.round((end - start) / 60000));
    inputDuree.value = String(duree);

    // Texte / labels
    if (labelActionCreerCreneau) labelActionCreerCreneau.textContent = "Modifier ce créneau";
    if (labelActionCreerRDV) labelActionCreerRDV.textContent = "Créer un rendez-vous sur ce créneau";

    blocChoixAction.classList.remove("hidden");
    blocRdvFields.classList.add("hidden");
    updateCreneauActionFields();

    // Reset champs RDV
    inputCreneauNom.value = "";
    inputCreneauEmail.value = "";
    inputCreneauTel.value = "";
    if (selectCreneauType) selectCreneauType.value = "";

    // Gestion des boutons selon statut
    // - libre : supprimer OK, libérer caché
    // - bloque : supprimer caché, libérer visible
    if (btnModalCreneauSupprimer) {
      if (statut === "libre") btnModalCreneauSupprimer.classList.remove("hidden");
      else btnModalCreneauSupprimer.classList.add("hidden");
    }

    if (btnModalCreneauLiberer) {
      if (statut === "bloque") {
        btnModalCreneauLiberer.classList.remove("hidden");
        btnModalCreneauLiberer.onclick = async () => {
          try {
            await postJSON(`/auth/api/creneaux/${creneauId}/liberer`, {});
            closeModalCreneau();
            calendar.refetchEvents();
          } catch (e) {
            alert(e.message);
          }
        };
      } else {
        btnModalCreneauLiberer.classList.add("hidden");
        btnModalCreneauLiberer.onclick = null;
      }
    }

    // Bouton supprimer (uniquement si libre)
    if (btnModalCreneauSupprimer) {
      btnModalCreneauSupprimer.onclick = () => {
        const ok = window.confirm("Supprimer ce créneau libre ?");
        if (!ok) return;

        fetch(`/auth/api/creneaux/${creneauId}/supprimer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        })
          .then((r) => r.json())
          .then((data) => {
            if (!data.success) return alert(data.error || "Impossible de supprimer le créneau.");
            closeModalCreneau();
            calendar.refetchEvents();
          })
          .catch(() => alert("Erreur réseau."));
      };
    }

    // Titre modale
    if (modalCreneauTitre) modalCreneauTitre.textContent = (statut === "bloque") ? "Créneau bloqué" : "Créneau libre";
    if (modalCreneauSousTitre) {
      modalCreneauSousTitre.textContent =
        (statut === "bloque")
          ? "Tu peux libérer ce créneau."
          : "Tu peux modifier l’horaire, créer un RDV ou supprimer ce créneau.";
    }

    openModalCreneau();
    setupClientSelectCalendar();
  }



  // ---------- SUBMIT MODALE CRÉNEAU / RDV ----------

  if (formCreneau) {
    formCreneau.addEventListener("submit", (e) => {
      e.preventDefault();

      const mode = inputMode.value;
      const creneauId = inputCreneauId.value || null;

      const base = new Date(inputDateIso.value);
      if (!inputHeureDebut.value) {
        alert("Merci de saisir une heure de début.");
        return;
      }

      const [hStr, mStr] = inputHeureDebut.value.split(":");
      base.setHours(parseInt(hStr || "0", 10), parseInt(mStr || "0", 10), 0, 0);

      const dureeMinutes = parseInt(inputDuree.value || "60", 10);
      if (isNaN(dureeMinutes) || dureeMinutes <= 0) {
        alert("Durée invalide.");
        return;
      }

      const startIso = base.toISOString();
      const endIso = new Date(base.getTime() + dureeMinutes * 60000).toISOString();

      const actionRadio = document.querySelector("input[name='creneau-action']:checked");
      const action = actionRadio ? actionRadio.value : "creer_creneau";

      const typeId = selectCreneauType ? selectCreneauType.value : "";
      const typeIdOrNull = typeId ? typeId : null;

      if (mode === "fromClick") {
        if (action === "creer_creneau") {
          // Créer un créneau libre
          fetch("/auth/api/creneaux-from-calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: startIso, end: endIso })
          })
            .then((r) => r.json())
            .then((data) => {
              if (!data.success) {
                alert(data.error || "Impossible de créer le créneau.");
                return;
              }
              closeModalCreneau();
              calendar.refetchEvents();
            })
            .catch((err) => {
              console.error(err);
              alert("Erreur réseau.");
            });
        } else {
          // Créer directement un RDV
          const nom = inputCreneauNom.value.trim();
          if (!nom) {
            alert("Merci de saisir le nom du client.");
            return;
          }
          if (!typeIdOrNull) {
            alert("Merci de choisir un type de séance.");
            return;
          }
          const email = inputCreneauEmail.value.trim();
          const tel = inputCreneauTel.value.trim();

          fetch("/auth/api/rdv-direct-from-calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              start: startIso,
              end: endIso,
              nom_client: nom,
              email_client: email || null,
              tel_client: tel || null,
              type_seance_id: typeIdOrNull
            })
          })
            .then((r) => r.json())
            .then((data) => {
              if (!data.success) {
                alert(data.error || "Impossible de créer le rendez-vous.");
                return;
              }
              closeModalCreneau();
              calendar.refetchEvents();
            })
            .catch((err) => {
              console.error(err);
              alert("Erreur réseau.");
            });
        }
      } else if (mode === "fromCreneau" && creneauId) {
        if (action === "creer_creneau") {
          // Modifier l'horaire du créneau
          fetch(`/auth/api/creneaux/${creneauId}/move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: startIso, end: endIso })
          })
            .then((r) => r.json())
            .then((data) => {
              if (!data.success) {
                alert(data.error || "Impossible de modifier le créneau.");
                return;
              }
              closeModalCreneau();
              calendar.refetchEvents();
            })
            .catch((err) => {
              console.error(err);
              alert("Erreur réseau.");
            });
        } else {
          // Créer un RDV sur ce créneau
          const nom = inputCreneauNom.value.trim();
          if (!nom) {
            alert("Merci de saisir le nom du client.");
            return;
          }
          if (!typeIdOrNull) {
            alert("Merci de choisir un type de séance.");
            return;
          }
          const email = inputCreneauEmail.value.trim();
          const tel = inputCreneauTel.value.trim();

          fetch("/auth/api/rdv-from-calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              creneau_id: creneauId,
              nom_client: nom,
              email_client: email || null,
              tel_client: tel || null,
              type_seance_id: typeIdOrNull
            })
          })
            .then((r) => r.json())
            .then((data) => {
              if (!data.success) {
                alert(data.error || "Erreur lors de la création du rendez-vous.");
                return;
              }
              closeModalCreneau();
              calendar.refetchEvents();
            })
            .catch((err) => {
              console.error(err);
              alert("Erreur réseau.");
            });
        }
      }
    });
  }

  // ---------- MODALE RDV ----------

  function openRDVModal(event) {
    if (!modalRDV) return;

    const ext = event.extendedProps || {};

    spanRDVClient.textContent = ext.nom_client || event.title || "";
    spanRDVEmail.textContent = ext.email_client || "—";
    spanRDVTel.textContent = ext.tel_client || "—";
    spanRDVType.textContent = ext.type_seance || "—";
    spanRDVStart.textContent = event.start ? event.start.toLocaleString() : "";
    spanRDVEnd.textContent = event.end ? event.end.toLocaleString() : "";

    const rdvId = event.id.split("-")[1];

    CURRENT_RDV_EVENT = event;

    // reset zone édition à chaque ouverture
    if (rdvEditZone) rdvEditZone.style.display = "none";
    if (rdvEditError) rdvEditError.textContent = "";

    // préremplir date/heure
    if (event.start && rdvEditDate && rdvEditTime) {
      const d = event.start;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      rdvEditDate.value = `${yyyy}-${mm}-${dd}`;
      rdvEditTime.value = `${hh}:${mi}`;
}


    if (spanRDVCommentaire) {
      spanRDVCommentaire.textContent = ext.commentaire || "—";
    }

    if (btnRDVAnnuler) {
      btnRDVAnnuler.onclick = () => {
        const sure = window.confirm("Annuler ce rendez-vous ?");
        if (!sure) return;

        fetch(`/auth/api/rdv/${rdvId}/annuler`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          }
        })
          .then((r) => r.json())
          .then((data) => {
            if (!data.success) {
              alert(data.error || "Impossible d'annuler ce rendez-vous.");
              return;
            }
            calendar.refetchEvents();
            closeModalRDV();
          })
          .catch((err) => {
            console.error(err);
            alert("Erreur lors de l'annulation.");
            
          });
      };

      CURRENT_RDV_EVENT = event;

      // cacher zone édition à l'ouverture
      if (rdvEditZone) rdvEditZone.style.display = "none";
      if (rdvEditError) rdvEditError.textContent = "";

      // pré-remplir date/heure avec le start actuel
      if (event.start && rdvEditDate && rdvEditTime) {
        const d = event.start;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mi = String(d.getMinutes()).padStart(2, "0");

        rdvEditDate.value = `${yyyy}-${mm}-${dd}`;
        rdvEditTime.value = `${hh}:${mi}`;
      }
    }

    if (btnRDVModifier) {
      btnRDVModifier.onclick = () => {
        const rdvId = String(event.id).includes("-")
          ? String(event.id).split("-")[1]
          : String(event.id);

        window.location.href = `/auth/rdv/${rdvId}/modifier`;
      };
    }

    openModalRDV();
  }

  // ---------- DRAG & DROP RDV ----------

  function handleMoveRdv(info) {
    const rdvId = info.event.id.split("-")[1];

    const start = info.event.start;
      if (!start) {
        alert("Ce rendez-vous n’a pas de date de début valide.");
        info.revert();
        return;
      }

      const newStart = start.toISOString();


    fetch(`/auth/api/rdv/${rdvId}/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ start: newStart })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          console.log("RDV déplacé");
          calendar.refetchEvents();
          return;
        }

        if (data.reason === "overlap" && data.conflicts && data.conflicts.length) {
          let msg = "Ce déplacement chevauche déjà ces rendez-vous :\n\n";
          data.conflicts.forEach((c) => {
            msg += `- ${c.nom_client} (${c.start} → ${c.end})\n`;
          });
          msg += "\nEs-tu sûr(e) de vouloir quand même chevaucher ces rendez-vous ?";

          const ok = window.confirm(msg);
          if (!ok) {
            info.revert();
            return;
          }

          fetch(`/auth/api/rdv/${rdvId}/move`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ start: newStart, end: newEnd, force: true })
          })
            .then((r2) => r2.json())
            .then((data2) => {
              if (!data2.success) {
                alert(data2.error || "Impossible de déplacer le rendez-vous.");
                info.revert();
                return;
              }
              calendar.refetchEvents();
            })
            .catch((err2) => {
              console.error(err2);
              alert("Erreur réseau.");
              info.revert();
            });
        } else {
          alert(data.error || "Impossible de déplacer le rendez-vous.");
          info.revert();
        }
      })
      .catch((err) => {
        console.error(err);
        alert("Erreur réseau.");
        info.revert();
      });
  }
});
