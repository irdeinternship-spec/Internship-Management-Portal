// Keeps a record's existing value selectable even after it has been retired
// from the reference list.
//
// Reference data is now live: an admin deleting a branch removes it from every
// dropdown immediately. But students store their branch/course/year by NAME,
// so records written before the deletion still hold it. Without this, editing
// such a record shows a select with no matching option - it renders blank, and
// saving the form writes that blank back, silently losing the value.
//
// Generalised from the ad-hoc version that already existed for one select in
// pages/StudentDetails.jsx's TrainingManagementForm.
export function withCurrentValue(options, ...currentValues) {
  return [...new Set([...options, ...currentValues].filter(Boolean))];
}

export default withCurrentValue;
