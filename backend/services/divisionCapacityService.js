const { getAdministration } = require("./administrationService");

// In-process lock, correct ONLY on a single instance - left as-is
// deliberately, not fixed as part of the Mongo migration (see the
// migration plan's step 5). It serializes the check-capacity-then-allocate
// sequence within this one Node process, so two nearly-simultaneous
// requests handled by the SAME process never both see a seat as free and
// both take it.
//
// It provides NO protection across multiple instances: if this app is ever
// scaled to more than one instance (a second Render dyno/instance, a second
// container, etc.), each instance holds its own independent
// `allocationLock` promise chain that knows nothing about the others. Two
// requests landing on two different instances at the same moment can both
// read the same division/branch as having exactly one seat left, both pass
// the capacity check, and both allocate - overfilling that division/branch
// past its configured seat limit, with no error and no indication anything
// went wrong. Fixing this for real would need a DB-level lock (e.g. an
// atomic conditional update on the Administration document, or a
// short-lived lock document/session) instead of this in-memory Promise.
//
// Holds today because Render's free tier is single-instance - there is no
// second process for this lock to fail to coordinate with. This stops being
// true the moment horizontal scaling is turned on for this service.
let allocationLock = Promise.resolve();

function withDivisionAllocationLock(work) {
  const previous = allocationLock;
  let release;
  allocationLock = new Promise((resolve) => { release = resolve; });
  return previous.then(work).finally(release);
}

const seatCount = (value) => Math.max(0, Number(value) || 0);

function calculateTotalVacancy(configuration) {
  return (configuration?.allowedBranches || []).reduce((total, branch) => {
    const seats = configuration?.branchSeats?.[branch];
    if (seats && typeof seats === "object") {
      return total + seatCount(seats.paid) + seatCount(seats.unpaid);
    }
    return total + seatCount(seats);
  }, 0);
}

function calculateAvailableSeats(configuredSeats, allocatedStudents) {
  return Math.max(0, seatCount(configuredSeats) - seatCount(allocatedStudents));
}

function calculateUtilization(allocatedStudents, configuredSeats) {
  const capacity = seatCount(configuredSeats);
  return capacity ? (seatCount(allocatedStudents) / capacity) * 100 : 0;
}

async function validateDivisionCapacity({ Student, studentId, division, branch, internshipType = "Unpaid" }) {
  const administration = await getAdministration();
  if (!administration.divisions.includes(division)) return "Select a valid division.";
  const configuration = administration.divisionConfigurations[division];
  const normalizedType = internshipType === "Paid" ? "Paid" : "Unpaid";
  const typeKey = normalizedType.toLowerCase();
  const branchSeats = seatCount(configuration?.branchSeats?.[branch]?.[typeKey] ?? (normalizedType === "Unpaid" ? configuration?.branchSeats?.[branch] : 0));
  if (!configuration?.allowedBranches?.includes(branch) || branchSeats === 0) return `No seats are configured for ${branch} in ${division}.`;

  const assigned = await Student.find({
    status: "Approved",
    "trainingManagement.division": division,
    completedStatus: { $ne: "Yes" },
  }).lean();
  const otherStudents = assigned.filter((assignedStudent) => String(assignedStudent._id) !== String(studentId));

  let paidCapacity = 0;
  let unpaidCapacity = 0;
  (configuration?.allowedBranches || []).forEach((b) => {
    const seats = configuration?.branchSeats?.[b];
    if (seats && typeof seats === "object") {
      paidCapacity += seatCount(seats.paid);
      unpaidCapacity += seatCount(seats.unpaid);
    } else {
      unpaidCapacity += seatCount(seats);
    }
  });

  const overallLimit = normalizedType === "Paid" ? administration.paidSeatLimit : administration.unpaidSeatLimit;
  if (Number.isSafeInteger(overallLimit)) {
    const allAssigned = await Student.find({ status: "Approved", completedStatus: { $ne: "Yes" } }).lean();
    const allocatedOverallForType = allAssigned.filter((assignedStudent) => (
      String(assignedStudent._id) !== String(studentId) &&
      assignedStudent.trainingManagement?.division &&
      (assignedStudent.internshipType || "Unpaid") === normalizedType
    )).length;
    if (calculateAvailableSeats(overallLimit, allocatedOverallForType) === 0) return `No available overall ${normalizedType.toLowerCase()} internship seats. The student cannot be assigned.`;
  }

  const typeCapacity = normalizedType === "Paid" ? paidCapacity : unpaidCapacity;
  const allocatedForType = otherStudents.filter((assignedStudent) => (assignedStudent.internshipType || "Unpaid") === normalizedType).length;
  if (calculateAvailableSeats(typeCapacity, allocatedForType) === 0) return `${division} has no available ${normalizedType.toLowerCase()} internship seats. The student cannot be assigned to this division.`;

  const allocatedForBranch = otherStudents.filter((assignedStudent) => assignedStudent.branch === branch && (assignedStudent.internshipType || "Unpaid") === normalizedType).length;
  if (calculateAvailableSeats(branchSeats, allocatedForBranch) === 0) return `No available seat for ${branch} in ${division}. Please assign the student to another division.`;

  return "";
}

async function validateBranchHasAvailableDivision({ Student, studentId, branch, internshipType }) {
  const administration = await getAdministration();
  for (const division of administration.divisions) {
    const capacityError = await validateDivisionCapacity({ Student, studentId, division, branch, internshipType });
    if (!capacityError) return "";
  }
  return `No available division/seat is currently available for ${branch}.`;
}

module.exports = {
  calculateTotalVacancy,
  calculateAvailableSeats,
  calculateUtilization,
  validateDivisionCapacity,
  validateBranchHasAvailableDivision,
  withDivisionAllocationLock,
};
