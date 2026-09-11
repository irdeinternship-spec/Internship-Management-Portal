const { getAdministration, saveAdministration } = require("../services/administrationService");
const { logActivity } = require("../utils/activityLogger");

const normalise = (value) => String(value || "").trim().replace(/\s+/g, " ");
const isDuplicate = (divisions, name, excluded = "") => divisions.some((division) => division.toLocaleLowerCase() === name.toLocaleLowerCase() && division !== excluded);
const respondError = (res, message) => res.status(400).json({ success: false, message });
const totalVacancies = (configurations) => Object.values(configurations || {}).reduce((sum, entry) => sum + Number(entry?.totalVacancy || 0), 0);

async function getConfiguration(req, res, next) {
  try { res.json({ success: true, administration: await getAdministration() }); } catch (error) { next(error); }
}

async function addDivision(req, res, next) {
  try {
    const name = normalise(req.body.name);
    if (!name) return respondError(res, "Division name cannot be empty.");
    const administration = await getAdministration();
    if (isDuplicate(administration.divisions, name)) return respondError(res, "A division with this name already exists.");
    administration.divisions.push(name);
    administration.divisionConfigurations[name] = { allowedBranches: [], paidSeats: 0, unpaidSeats: 0, totalVacancy: 0, branchSeats: {} };
    await saveAdministration(administration);

    await logActivity({
      req,
      module: "Administration",
      action: "Added Division",
      description: `Added new division: ${name}.`,
      status: "Success",
    });

    res.status(201).json({ success: true, message: "Division added successfully.", administration });
  } catch (error) {
    await logActivity({
      req,
      module: "Administration",
      action: "Added Division",
      description: `Failed to add division. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
}

async function updateDivision(req, res, next) {
  try {
    const previousName = normalise(req.params.name);
    const name = normalise(req.body.name);
    if (!name) return respondError(res, "Division name cannot be empty.");
    const administration = await getAdministration();
    const index = administration.divisions.findIndex((division) => division === previousName);
    if (index < 0) return res.status(404).json({ success: false, message: "Division not found." });
    if (isDuplicate(administration.divisions, name, previousName)) return respondError(res, "A division with this name already exists.");
    administration.divisions[index] = name;
    administration.divisionConfigurations[name] = administration.divisionConfigurations[previousName] || { allowedBranches: [], paidSeats: 0, unpaidSeats: 0, totalVacancy: 0, branchSeats: {} };
    delete administration.divisionConfigurations[previousName];
    await saveAdministration(administration);
    res.json({ success: true, message: "Division updated successfully.", administration });
  } catch (error) { next(error); }
}

async function deleteDivision(req, res, next) {
  try {
    const name = normalise(req.params.name);
    const administration = await getAdministration();
    const index = administration.divisions.findIndex((division) => division === name);
    if (index < 0) return res.status(404).json({ success: false, message: "Division not found." });
    administration.divisions.splice(index, 1);
    delete administration.divisionConfigurations[name];
    await saveAdministration(administration);

    await logActivity({
      req,
      module: "Administration",
      action: "Deleted Division",
      description: `Deleted division: ${name}.`,
      status: "Success",
    });

    res.json({ success: true, message: "Division deleted successfully.", administration });
  } catch (error) {
    await logActivity({
      req,
      module: "Administration",
      action: "Deleted Division",
      description: `Failed to delete division. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
}

async function updateSeats(req, res, next) {
  try {
    const paidSeatLimit = Number(req.body.paidSeatLimit);
    const unpaidSeatLimit = Number(req.body.unpaidSeatLimit);
    if (!Number.isSafeInteger(paidSeatLimit) || paidSeatLimit < 0 || !Number.isSafeInteger(unpaidSeatLimit) || unpaidSeatLimit < 0) return respondError(res, "Enter whole numbers of 0 or more for Paid and Unpaid seats.");
    const totalAllocatedSeats = paidSeatLimit + unpaidSeatLimit;
    if (totalAllocatedSeats <= 0) return respondError(res, "At least one overall seat limit must be greater than zero.");
    const administration = await getAdministration();
    const configuredVacancies = totalVacancies(administration.divisionConfigurations);
    if (configuredVacancies > totalAllocatedSeats) return respondError(res, `Total division vacancies (${configuredVacancies}) cannot exceed total allocated seats (${totalAllocatedSeats}). Reduce division vacancies first.`);
    const configuredPaid = Object.values(administration.divisionConfigurations).reduce((sum, entry) => sum + Number(entry?.paidSeats || 0), 0);
    const configuredUnpaid = Object.values(administration.divisionConfigurations).reduce((sum, entry) => sum + Number(entry?.unpaidSeats || 0), 0);
    if (configuredPaid > paidSeatLimit || configuredUnpaid > unpaidSeatLimit) return respondError(res, "Division Paid or Unpaid capacity cannot exceed its corresponding overall seat limit.");
    administration.totalAllocatedSeats = totalAllocatedSeats;
    administration.paidSeatLimit = paidSeatLimit;
    administration.unpaidSeatLimit = unpaidSeatLimit;
    administration.totalSeatLimit = totalAllocatedSeats;
    await saveAdministration(administration);

    await logActivity({
      req,
      module: "Administration",
      action: "Updated Vacancy",
      description: `Updated overall seats: Paid ${paidSeatLimit}, Unpaid ${unpaidSeatLimit}, Total ${totalAllocatedSeats}.`,
      status: "Success",
    });

    res.json({ success: true, message: "Seat allocation updated successfully.", administration });
  } catch (error) {
    await logActivity({
      req,
      module: "Administration",
      action: "Updated Vacancy",
      description: `Failed to update total allocated seats. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
}

async function getDivisionConfigurations(req, res, next) {
  try {
    const administration = await getAdministration();
    res.json({ success: true, divisions: administration.divisions, configurations: administration.divisionConfigurations });
  } catch (error) { next(error); }
}

async function saveDivisionConfigurations(req, res, next) {
  try {
    const requested = req.body.configurations;
    if (!requested || typeof requested !== "object" || Array.isArray(requested)) return respondError(res, "Division configuration data is required.");
    const administration = await getAdministration();

    // COMPLETENESS GUARD. The loop below rebuilds an entry for EVERY division
    // from `requested[division] || {}`, so a payload that omits a division
    // silently clears its configuration. That is correct for "save the whole
    // config screen" - which is what this endpoint is - but catastrophic for a
    // partial payload from a stale or half-loaded client, which would wipe
    // every division it didn't know about.
    //
    // Presence is tested with hasOwnProperty rather than truthiness on purpose:
    // a division sent as {} or { allowedBranches: [] } is an admin DELIBERATELY
    // clearing it and must be honoured, while an absent key means the client
    // never had it. Conflating those is exactly the bug being guarded against.
    //
    // `unknown` is checked too, catching a client whose division list predates
    // a concurrent rename or delete.
    const preview = (names) =>
      names.slice(0, 5).join(", ") + (names.length > 5 ? `, +${names.length - 5} more` : "");

    const known = administration.divisions;
    const missing = known.filter((division) => !Object.prototype.hasOwnProperty.call(requested, division));
    const unknown = Object.keys(requested).filter((division) => !known.includes(division));

    if (missing.length) {
      return respondError(
        res,
        `This save is missing ${missing.length} of ${known.length} divisions (${preview(missing)}) and ` +
          `would have cleared their configuration. Reload the Division Configuration screen and try again.`
      );
    }
    if (unknown.length) {
      return respondError(
        res,
        `This save refers to ${unknown.length} division(s) that no longer exist (${preview(unknown)}). ` +
          `Reload the Division Configuration screen and try again.`
      );
    }

    const configurations = {};
    for (const division of administration.divisions) {
      const entry = requested[division] || {};
      const existing = administration.divisionConfigurations[division] || {};
      const allowedBranches = Array.isArray(entry.allowedBranches) ? [...new Set(entry.allowedBranches.map((branch) => String(branch).trim()).filter(Boolean))] : [];
      let paidSeats = 0;
      let unpaidSeats = 0;
      const branchSeats = {};
      for (const branch of allowedBranches) {
        const val = entry.branchSeats?.[branch];
        let paid = 0;
        let unpaid = 0;
        if (val && typeof val === "object") {
          paid = Number(val.paid ?? 0);
          unpaid = Number(val.unpaid ?? 0);
        } else {
          unpaid = Number(val ?? 0);
        }
        if (!Number.isSafeInteger(paid) || paid < 0 || !Number.isSafeInteger(unpaid) || unpaid < 0) {
          return respondError(res, `Enter whole numbers of 0 or more for ${branch} in ${division}.`);
        }
        branchSeats[branch] = { paid, unpaid };
        paidSeats += paid;
        unpaidSeats += unpaid;
      }
      configurations[division] = { allowedBranches, paidSeats, unpaidSeats, totalVacancy: paidSeats + unpaidSeats, branchSeats };
    }
    const configuredVacancies = totalVacancies(configurations);
    if (configuredVacancies > administration.totalAllocatedSeats) return respondError(res, `Total division vacancies (${configuredVacancies}) cannot exceed the configured total allocated seats (${administration.totalAllocatedSeats}). Reduce division vacancies before saving.`);
    if (administration.paidSeatLimit !== undefined && administration.unpaidSeatLimit !== undefined) {
      const configuredPaid = Object.values(configurations).reduce((sum, entry) => sum + Number(entry.paidSeats || 0), 0);
      const configuredUnpaid = Object.values(configurations).reduce((sum, entry) => sum + Number(entry.unpaidSeats || 0), 0);
      if (configuredPaid > administration.paidSeatLimit || configuredUnpaid > administration.unpaidSeatLimit) return respondError(res, "Division Paid or Unpaid capacity cannot exceed its corresponding overall seat limit.");
    }
    administration.divisionConfigurations = configurations;
    await saveAdministration(administration);

    await logActivity({
      req,
      module: "Administration",
      action: "Updated Branch Configuration",
      description: "Updated division vacancy and allowed branch configurations.",
      status: "Success",
    });

    res.json({ success: true, message: "Division configuration updated successfully.", configurations });
  } catch (error) {
    await logActivity({
      req,
      module: "Administration",
      action: "Updated Branch Configuration",
      description: `Failed to update division branch configuration. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
}

async function saveProformaConfig(req, res, next) {
  try {
    const { proformaQuarterEnding, proformaSection1, reportPeriod, proformaSelectedPeriod, attendanceSelectedPeriod } = req.body;
    const administration = await getAdministration();

    if (proformaSelectedPeriod !== undefined) {
      administration.proformaSelectedPeriod = proformaSelectedPeriod;
    }
    if (attendanceSelectedPeriod !== undefined) {
      administration.attendanceSelectedPeriod = attendanceSelectedPeriod;
    }

    if (reportPeriod) {
      administration.proformas ||= {};
      administration.proformas[reportPeriod] = {
        proformaQuarterEnding,
        proformaSection1
      };
      // Keep legacy fields in sync for compatibility
      if (proformaQuarterEnding !== undefined) administration.proformaQuarterEnding = proformaQuarterEnding;
      if (proformaSection1 !== undefined) administration.proformaSection1 = proformaSection1;
    } else {
      if (proformaQuarterEnding !== undefined) {
        administration.proformaQuarterEnding = proformaQuarterEnding;
      }
      if (proformaSection1 !== undefined) {
        administration.proformaSection1 = {
          ...administration.proformaSection1,
          ...proformaSection1
        };
      }
    }

    await saveAdministration(administration);
    res.json({ success: true, message: "Proforma configuration saved successfully.", administration });
  } catch (error) {
    next(error);
  }
}

async function updateCertificateNumber(req, res, next) {
  try {
    const nextCertificateNumber = Number(req.body.nextCertificateNumber);
    if (!Number.isSafeInteger(nextCertificateNumber) || nextCertificateNumber <= 0) {
      return respondError(res, "Certificate number must be a positive integer.");
    }
    const administration = await getAdministration();
    administration.nextCertificateNumber = nextCertificateNumber;
    await saveAdministration(administration);

    await logActivity({
      req,
      module: "Administration",
      action: "Updated Certificate Number",
      description: `Updated starting/next certificate number to ${nextCertificateNumber}.`,
      status: "Success",
    });

    res.json({ success: true, message: "Certificate number updated successfully.", administration });
  } catch (error) {
    await logActivity({
      req,
      module: "Administration",
      action: "Updated Certificate Number",
      description: `Failed to update certificate number. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
}

module.exports = { 
  getConfiguration, 
  addDivision, 
  updateDivision, 
  deleteDivision, 
  updateSeats, 
  getDivisionConfigurations, 
  saveDivisionConfigurations, 
  saveProformaConfig,
  updateCertificateNumber
};
