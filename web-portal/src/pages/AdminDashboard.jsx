import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import DashboardCards from "../components/Admin/DashboardCards";
import FilterBar from "../components/Admin/FilterBar";
import SearchBar from "../components/Admin/SearchBar";
import SortControls from "../components/Admin/SortControls";
import StudentTable from "../components/Admin/StudentTable";
import {
  clearAdminToken,
  deleteAdminStudents,
  downloadCertificates,
  fetchAdminStudents,
  updateStudentReview,
  setupRecoveryInfo,
  downloadAttendanceReportPdf,
  fetchAdministration,
  saveProformaConfig,
  createPdfUrl,
  exportApplicationsExcel,
} from "../services/adminService";
import { createGyapanPreview, generateGyapanPdf } from "../services/gyapanService";
import { downloadOfferLetterPdf } from "../services/offerLetterService";
import { readDocumentResponse, printPdf } from "../services/documentFileService";
import { getPresignedFileUrl } from "../utils/presignedFile";
import { useAdminAuth } from "../auth/useAdminAuth";
import StudentForm from "../components/Form/StudentForm";
import StudentDetails from "./StudentDetails";
import "../styles/admin.css";

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function formatReportDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, '0');
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function formatDob(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    if (typeof value === "string" && value.includes("/")) return value;
    return "";
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

const initialFilters = {
  collegeName: "",
  branch: "",
  year: "",
  status: "",
  registrationDate: "",
  division: "",
  internshipType: "",
  resignation: "",
};
const CERTIFICATE_DOWNLOADS_KEY = "drdoCertificateDownloadedStudentIds";
const ISM_DOWNLOADS_KEY = "drdoIsmDownloadedStudentIds";
const MANAGEMENT_COLUMNS = [
  ["serial", "S.No."], ["name", "Name"], ["referenceId", "Reference ID"], ["course", "Course"], ["branch", "Branch"], ["year", "Year"], ["collegeName", "College Name"], ["location", "College Location"], ["email", "Email"], ["phone", "Phone"], ["status", "Status"],
];

function savedCertificateDownloadIds() {
  try {
    const value = JSON.parse(localStorage.getItem(CERTIFICATE_DOWNLOADS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savedIsmDownloadIds() {
  try {
    const value = JSON.parse(localStorage.getItem(ISM_DOWNLOADS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getInitialView() {
  const path = window.location.pathname;
  if (path.startsWith("/admin/student-management/new")) {
    return "student-management-new";
  }
  if (path.startsWith("/admin/student-management/")) {
    return "student-management-details";
  }
  if (path.startsWith("/admin/student-management")) {
    return "student-management";
  }
  if (path.startsWith("/admin/approved-students")) {
    return "approved-students";
  }
  if (path.startsWith("/admin/quarterly-reports")) {
    return "quarterly-reports";
  }
  if (path.startsWith("/admin/administration")) {
    return "administration";
  }
  return "home";
}

function AdminDashboard() {
  const { admin, validateSession } = useAdminAuth();
  const isMainAdmin = admin?.role === "MAIN_ADMIN";

  // Navigation & Workflow States
  const [currentView, setCurrentView] = useState(getInitialView);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [isDetailsDirty, setIsDetailsDirty] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [saveTrigger, setSaveTrigger] = useState(0);
  const [quarterlySubView, setQuarterlySubView] = useState("menu");
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [newStudentType, setNewStudentType] = useState("");
  const [proformaQuarterEnding, setProformaQuarterEnding] = useState("");
  const [proformaSection1, setProformaSection1] = useState({
    B_dg_cluster: "", C_dg_cluster: "", D_dg_cluster: "", E_dg_cluster: "", F_dg_cluster: "",
    B_lab: "", B_remark: "",
    C_lab: "", C_remark: "",
    D_lab: "", D_remark: "",
    E_lab: "", E_remark: "",
    F_lab: "", F_remark: ""
  });
  const [proformaStudents, setProformaStudents] = useState([]);
  const [proformaFromDate, setProformaFromDate] = useState("");
  const [proformaToDate, setProformaToDate] = useState("");
  const [proformaGenerated, setProformaGenerated] = useState(false);

  const [attendanceFromDate, setAttendanceFromDate] = useState("");
  const [attendanceToDate, setAttendanceToDate] = useState("");
  const [attendanceGenerated, setAttendanceGenerated] = useState(false);

  // Recovery Setup States
  const [showRecoverySetup, setShowRecoverySetup] = useState(false);
  const [recoveryForm, setRecoveryForm] = useState({ secretQuestion: "", secretAnswer: "" });
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  // Original Table & Data States
  const [students, setStudents] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [isExportingApplications, setIsExportingApplications] = useState(false);
  const [summary, setSummary] = useState({});
  const [administration, setAdministration] = useState(null);
  const [search, setSearch] = useState(() => {
    const path = window.location.pathname;
    if (path.startsWith("/admin/approved-students")) {
      return sessionStorage.getItem("approved_search") || "";
    }
    return "";
  });
  const [internshipTypeFilter, setInternshipTypeFilter] = useState("all");
  const [filters, setFilters] = useState(() => {
    const path = window.location.pathname;
    if (path.startsWith("/admin/approved-students")) {
      try {
        const saved = sessionStorage.getItem("approved_filters");
        if (saved) return JSON.parse(saved);
      } catch (e) { }
      return { ...initialFilters, status: "", internshipType: "" };
    }
    return initialFilters;
  });
  const [sort, setSort] = useState(() => {
    const path = window.location.pathname;
    if (path.startsWith("/admin/approved-students")) {
      try {
        const saved = sessionStorage.getItem("approved_sort");
        if (saved) return JSON.parse(saved);
      } catch (e) { }
    }
    return { sortBy: "submittedAt", sortOrder: "desc" };
  });

  useEffect(() => {
    if (window.location.pathname.startsWith("/admin/approved-students")) {
      sessionStorage.setItem("approved_search", search);
    }
  }, [search]);

  useEffect(() => {
    if (window.location.pathname.startsWith("/admin/approved-students")) {
      sessionStorage.setItem("approved_filters", JSON.stringify(filters));
    }
  }, [filters]);

  useEffect(() => {
    if (window.location.pathname.startsWith("/admin/approved-students")) {
      sessionStorage.setItem("approved_sort", JSON.stringify(sort));
    }
  }, [sort]);

  useEffect(() => {
    if (quarterlySubView === "proforma") {
      const approvedPaid = allStudents.filter(
        (s) => s.status === "Approved" && s.internshipType === "Paid"
      );
      const filtered = approvedPaid.filter((s) => {
        const joining = s.trainingManagement?.fromDate || "";
        if (proformaFromDate && proformaToDate) {
          const isInSelectedRange = joining >= proformaFromDate && joining <= proformaToDate;
          return isInSelectedRange;
        }
        return true;
      });
      const mapped = filtered.map((student) => {
        const project = student.paidInternshipProjectDetails || {};
        const training = student.trainingManagement || {};
        const discipline = `${student.course || ""} - ${student.branch || ""}`;
        const joiningDate = training.fromDate ? formatReportDate(training.fromDate) : "";
        const completionDate = training.toDate ? formatReportDate(training.toDate) : "";
        const resignationDate = student.resignationStatus === "Yes" && student.resignationDate ? formatReportDate(student.resignationDate) : "";

        return {
          _id: student._id,
          name: student.name || "",
          discipline: discipline || "",
          gender: student.gender || "",
          dob: formatDob(student.dob),
          joiningDate: joiningDate || "",
          projectName: project.projectName || "",
          designationTitle: project.designationTitle || "",
          supervisorName: project.supervisorName || "",
          projectNameAndPdc: project.projectNameAndPdc || "",
          achievements: project.achievements || "",
          completionDate: completionDate || "",
          resignationDate: resignationDate || "",
          remarks: ""
        };
      });
      setProformaStudents(mapped);
    }
  }, [quarterlySubView, allStudents, proformaFromDate, proformaToDate]);

  useEffect(() => {
    if (quarterlySubView && quarterlySubView !== "menu") {
      loadAll();
    }
  }, [quarterlySubView]);

  const [loading, setLoading] = useState(true);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState("");
  const [documentModal, setDocumentModal] = useState(null);
  const [documentSelectedIds, setDocumentSelectedIds] = useState([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentQueue, setDocumentQueue] = useState([]);
  const [documentIndex, setDocumentIndex] = useState(0);
  const [documentOutputChoice, setDocumentOutputChoice] = useState(false);
  const [documentRenderMode, setDocumentRenderMode] = useState("full");
  const [certificatePreview, setCertificatePreview] = useState(null);
  const [certificateDownloadedIds, setCertificateDownloadedIds] = useState(savedCertificateDownloadIds);
  const [ismDownloadedIds, setIsmDownloadedIds] = useState(savedIsmDownloadIds);
  const [offerLetterMode, setOfferLetterMode] = useState(false);
  const [offerLetterIds, setOfferLetterIds] = useState([]);
  const [offerLetterBusy, setOfferLetterBusy] = useState(false);
  const [offerLetterQueue, setOfferLetterQueue] = useState([]);
  const [offerLetterAction, setOfferLetterAction] = useState("");
  const [managementFieldsOpen, setManagementFieldsOpen] = useState(false);
  const [managementFields, setManagementFields] = useState(() => MANAGEMENT_COLUMNS.map(([key]) => key));

  // Signature customization states
  const [signature, setSignature] = useState(null);
  const [signatureDraft, setSignatureDraft] = useState({ name: "VAIBHAV GUPTA", designation: "TECHNICAL OFFICER 'C'" });
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false);
  const [signatureError, setSignatureError] = useState("");

  // Inline status dropdown confirmation state (Student Management only)
  const [statusConfirm, setStatusConfirm] = useState(null); // { studentId, oldStatus, newStatus }
  const [statusUpdating, setStatusUpdating] = useState(null); // studentId being updated

  const query = useMemo(
    () => ({
      search,
      ...filters,
      ...sort,
      isApprovedView: window.location.pathname.startsWith("/admin/approved-students") ? "true" : undefined
    }),
    [filters, search, sort]
  );

  // Original load effects
  useEffect(() => {
    let ignore = false;

    async function loadStudents() {
      setLoading(true);
      setError("");

      try {
        const response = await fetchAdminStudents(query);
        if (ignore) return;
        setStudents(response.students);
        setSummary(response.summary);
        setSelectedIds([]);
      } catch (err) {
        if (err.message.toLowerCase().includes("token")) {
          clearAdminToken();
          window.history.pushState({}, "", "/admin/login");
          window.dispatchEvent(new PopStateEvent("popstate"));
          return;
        }

        setError(err.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadStudents();

    return () => {
      ignore = true;
    };
  }, [query]);

  // Load all students for local search/filters/options in Student Management
  const loadAll = async () => {
    try {
      const adminResponse = await fetchAdministration();
      setAdministration(adminResponse.administration);

      let fromDate = "";
      let toDate = "";
      if (quarterlySubView === "proforma") {
        fromDate = adminResponse.administration?.proformaSelectedPeriod?.fromDate || "";
        toDate = adminResponse.administration?.proformaSelectedPeriod?.toDate || "";
      } else if (quarterlySubView === "first-quarter" || quarterlySubView === "second-quarter") {
        fromDate = adminResponse.administration?.attendanceSelectedPeriod?.fromDate || "";
        toDate = adminResponse.administration?.attendanceSelectedPeriod?.toDate || "";
      }

      let params = {
        sortBy: "submittedAt",
        sortOrder: "desc",
      };
      if (fromDate && toDate) {
        params.isQuarterlyReport = "true";
        params.fromDate = fromDate;
        params.toDate = toDate;
      }
      const response = await fetchAdminStudents(params);
      setAllStudents(response.students);
    } catch {
      setAllStudents([]);
    }
  };

  const formatQuarterEnding = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  useEffect(() => {
    if (administration) {
      if (administration.proformaSelectedPeriod?.fromDate && administration.proformaSelectedPeriod?.toDate) {
        setProformaFromDate(administration.proformaSelectedPeriod.fromDate);
        setProformaToDate(administration.proformaSelectedPeriod.toDate);
        setProformaGenerated(true);
      }
      if (administration.attendanceSelectedPeriod?.fromDate && administration.attendanceSelectedPeriod?.toDate) {
        setAttendanceFromDate(administration.attendanceSelectedPeriod.fromDate);
        setAttendanceToDate(administration.attendanceSelectedPeriod.toDate);
        setAttendanceGenerated(true);
      }
    }
  }, [administration]);

  useEffect(() => {
    if (proformaGenerated && proformaFromDate && proformaToDate && administration) {
      const periodKey = `${proformaFromDate}_${proformaToDate}`;
      const saved = administration.proformas?.[periodKey];
      if (saved) {
        if (saved.proformaQuarterEnding) {
          setProformaQuarterEnding(saved.proformaQuarterEnding);
        } else {
          setProformaQuarterEnding(formatQuarterEnding(proformaToDate));
        }
        if (saved.proformaSection1) {
          setProformaSection1({
            B_dg_cluster: "", C_dg_cluster: "", D_dg_cluster: "", E_dg_cluster: "", F_dg_cluster: "",
            B_lab: "", B_remark: "",
            C_lab: "", C_remark: "",
            D_lab: "", D_remark: "",
            E_lab: "", E_remark: "",
            F_lab: "", F_remark: "",
            ...saved.proformaSection1
          });
        } else {
          setProformaSection1({
            B_dg_cluster: "", C_dg_cluster: "", D_dg_cluster: "", E_dg_cluster: "", F_dg_cluster: "",
            B_lab: "", B_remark: "",
            C_lab: "", C_remark: "",
            D_lab: "", D_remark: "",
            E_lab: "", E_remark: "",
            F_lab: "", F_remark: ""
          });
        }
      } else {
        setProformaQuarterEnding(formatQuarterEnding(proformaToDate));
        setProformaSection1({
          B_dg_cluster: "", C_dg_cluster: "", D_dg_cluster: "", E_dg_cluster: "", F_dg_cluster: "",
          B_lab: "", B_remark: "",
          C_lab: "", C_remark: "",
          D_lab: "", D_remark: "",
          E_lab: "", E_remark: "",
          F_lab: "", F_remark: ""
        });
      }
    }
  }, [proformaGenerated, proformaFromDate, proformaToDate, administration]);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    return () => {
      if (certificatePreview?.url) {
        URL.revokeObjectURL(certificatePreview.url);
      }
    };
  }, [certificatePreview?.url]);

  useEffect(() => {
    setShowRecoverySetup(false);
  }, [admin]);

  const handleRecoverySetupSubmit = async (e) => {
    e.preventDefault();
    setRecoveryError("");
    if (!recoveryForm.secretQuestion || !recoveryForm.secretAnswer) {
      setRecoveryError("All fields are required.");
      return;
    }
    setRecoveryBusy(true);
    try {
      await setupRecoveryInfo(recoveryForm);
      await validateSession();
      setShowRecoverySetup(false);
    } catch (err) {
      setRecoveryError(err.message || "Failed to save recovery info.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const displayedStudents = useMemo(() => {
    let result = students;

    // Frontend division filter (since backend does not support filtering by division)
    if (filters.division) {
      result = result.filter(
        (student) => student.trainingManagement?.division === filters.division
      );
    }

    // Frontend sorting (since backend does not support sorting for all columns)
    if (sort.sortBy) {
      result = [...result].sort((a, b) => {
        let left, right;
        switch (sort.sortBy) {
          case "referenceId":
            left = a.referenceId || "";
            right = b.referenceId || "";
            break;
          case "name":
            left = a.name || "";
            right = b.name || "";
            break;
          case "collegeName":
            left = a.collegeName || "";
            right = b.collegeName || "";
            break;
          case "branch":
            left = a.branch || "";
            right = b.branch || "";
            break;
          case "division":
            left = a.trainingManagement?.division || "";
            right = b.trainingManagement?.division || "";
            break;
          case "year":
            left = a.year || "";
            right = b.year || "";
            break;
          case "cgpa":
            left = Number(a.cgpa) || 0;
            right = Number(b.cgpa) || 0;
            break;
          case "submittedAt":
            left = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
            right = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
            break;
          case "approvedDate":
            left = a.approvedDate ? new Date(a.approvedDate).getTime() : 0;
            right = b.approvedDate ? new Date(b.approvedDate).getTime() : 0;
            break;
          case "status":
            left = a.status || "";
            right = b.status || "";
            break;
          default:
            left = "";
            right = "";
        }

        if (typeof left === "string") left = left.toLowerCase();
        if (typeof right === "string") right = right.toLowerCase();

        if (left < right) return sort.sortOrder === "asc" ? -1 : 1;
        if (left > right) return sort.sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [students, filters.division, sort]);

  useEffect(() => {
    const handlePop = () => {
      setCurrentView(getInitialView());
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  // Intercept beforeunload events if details form is dirty
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDetailsDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Do you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDetailsDirty]);

  // View transition checks
  const handleSwitchViewWithCheck = (nextView) => {
    if (isDetailsDirty) {
      setPendingAction({ type: "switch-view", payload: nextView });
      setShowUnsavedModal(true);
    } else {
      let dest = "/admin/dashboard";
      if (nextView === "student-management") {
        dest = "/admin/student-management";
      } else if (nextView === "approved-students") {
        dest = "/admin/approved-students";
        setFilters({ ...initialFilters, status: "Approved" });
      } else if (nextView === "quarterly-reports") {
        dest = "/admin/quarterly-reports";
        setQuarterlySubView("menu");
      } else if (nextView === "administration") {
        dest = "/admin/administration";
      } else {
        setFilters(initialFilters);
      }
      window.history.pushState({}, "", dest);
      window.dispatchEvent(new PopStateEvent("popstate"));
      setCurrentView(nextView);
    }
  };

  const handleGoHomeWithCheck = () => {
    if (isDetailsDirty) {
      setPendingAction({ type: "go-home" });
      setShowUnsavedModal(true);
    } else {
      window.history.pushState({}, "", "/admin/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
      setCurrentView("home");
    }
  };

  const handleSelectStudentWithCheck = (studentId) => {
    if (isDetailsDirty) {
      setPendingAction({ type: "select-student", payload: studentId });
      setShowUnsavedModal(true);
    } else {
      window.history.pushState({}, "", `/admin/student-management/${studentId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  const handleGoToRegistrationWithCheck = () => {
    if (isDetailsDirty) {
      setPendingAction({ type: "go-registration" });
      setShowUnsavedModal(true);
    } else {
      window.history.pushState({}, "", "/admin/student-management/new");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  const handleCloseRegistrationForm = useCallback((registrationSuccess) => {
    window.history.pushState({}, "", "/admin/student-management");
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (registrationSuccess) {
      loadAll();
      fetchAdminStudents(query).then((response) => {
        setStudents(response.students);
        setSummary(response.summary);
      }).catch(() => { });
    }
  }, [query]);

  const executePendingAction = (action = pendingAction) => {
    if (!action) return;

    if (action.type === "select-student") {
      window.history.pushState({}, "", `/admin/student-management/${action.payload}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else if (action.type === "go-registration") {
      window.history.pushState({}, "", "/admin/student-management/new");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else if (action.type === "go-home") {
      window.history.pushState({}, "", "/admin/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
      setCurrentView("home");
    } else if (action.type === "switch-view") {
      let dest = "/admin/dashboard";
      if (action.payload === "student-management") {
        dest = "/admin/student-management";
      } else if (action.payload === "approved-students") {
        dest = "/admin/approved-students";
        setFilters({ ...initialFilters, status: "Approved" });
      } else if (action.payload === "quarterly-reports") {
        dest = "/admin/quarterly-reports";
      } else if (action.payload === "administration") {
        dest = "/admin/administration";
      } else {
        setFilters(initialFilters);
      }
      window.history.pushState({}, "", dest);
      window.dispatchEvent(new PopStateEvent("popstate"));
      setCurrentView(action.payload);
    }

    setPendingAction(null);
    setShowUnsavedModal(false);
  };

  // Callback successes from StudentDetails
  const handleSaveSuccess = (updatedStudent) => {
    setAllStudents(current => current.map(s => s._id === updatedStudent._id ? updatedStudent : s));
    setStudents(current => current.map(s => s._id === updatedStudent._id ? updatedStudent : s));
    setIsDetailsDirty(false);
    if (pendingAction) {
      executePendingAction();
    }
  };

  const handleSaveFailure = (errMsg) => {
    setPendingAction(null);
    setShowUnsavedModal(false);
  };

  const handleDeleteSuccess = (deletedId) => {
    setAllStudents(current => current.filter(s => s._id !== deletedId));
    setStudents(current => current.filter(s => s._id !== deletedId));
    setSelectedStudentId(null);
    setIsDetailsDirty(false);
    if (pendingAction) {
      executePendingAction();
    }
  };

  const handleLogout = useCallback(() => {
    clearAdminToken();
    window.history.pushState({}, "", "/admin/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const openStudent = useCallback((id) => {
    window.history.pushState({}, "", `/admin/students/${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const toggleApprovedStudents = useCallback(() => {
    setFilters((current) => ({
      ...current,
      status: current.status === "Approved" ? "" : "Approved",
    }));
  }, []);

  const openDocumentModal = useCallback((type) => {
    setDocumentModal(type);
    setDocumentSelectedIds([]);
    setDocumentSearch("");
    setDocumentError("");
    setDocumentQueue([]);
    setDocumentIndex(0);
    setDocumentOutputChoice(false);
    setDocumentRenderMode("full");
    if (certificatePreview?.url) URL.revokeObjectURL(certificatePreview.url);
    setCertificatePreview(null);
  }, [certificatePreview]);

  const closeDocumentModal = useCallback(() => {
    if (certificatePreview?.url) URL.revokeObjectURL(certificatePreview.url);
    setDocumentModal(null);
    setDocumentQueue([]);
    setDocumentOutputChoice(false);
    setCertificatePreview(null);
    setDocumentError("");
    setSignature(null);
    setSignatureEditorOpen(false);
    setSignatureError("");
  }, [certificatePreview]);

  const documentStudents = useMemo(() => {
    return allStudents
      .filter((student) => student.status === "Approved")
      .filter((student) => {
        if (filters.internshipType === "Paid") {
          return student.internshipType === "Paid";
        }
        if (filters.internshipType === "Unpaid") {
          return student.internshipType === "Unpaid" || !student.internshipType;
        }
        return true;
      })
      .filter((student) => {
        if (documentModal === "certificate") {
          return student.trainingManagement?.completed === "Yes";
        }
        if (documentModal === "ism") {
          return student.trainingManagement?.joined === "Yes";
        }
        return true;
      })
      .filter((student) => {
        const term = documentSearch.trim().toLowerCase();
        return !term || [student.name, student.referenceId, student.collegeName, student.branch, student.course].some((value) => String(value || "").toLowerCase().includes(term));
      })
      .sort((a, b) => {
        if (documentModal === "certificate") {
          const dateA = a.trainingManagement?.completionDate ? new Date(a.trainingManagement.completionDate).getTime() : 0;
          const dateB = b.trainingManagement?.completionDate ? new Date(b.trainingManagement.completionDate).getTime() : 0;
          if (dateA !== dateB) return dateB - dateA;
          const timeA = a.trainingManagement?.updatedAt ? new Date(a.trainingManagement.updatedAt).getTime() : 0;
          const timeB = b.trainingManagement?.updatedAt ? new Date(b.trainingManagement.updatedAt).getTime() : 0;
          return timeB - timeA;
        }
        if (documentModal === "ism") {
          const dateA = a.trainingManagement?.joinedDate ? new Date(a.trainingManagement.joinedDate).getTime() : 0;
          const dateB = b.trainingManagement?.joinedDate ? new Date(b.trainingManagement.joinedDate).getTime() : 0;
          if (dateA !== dateB) return dateB - dateA;
          const timeA = a.trainingManagement?.updatedAt ? new Date(a.trainingManagement.updatedAt).getTime() : 0;
          const timeB = b.trainingManagement?.updatedAt ? new Date(b.trainingManagement.updatedAt).getTime() : 0;
          return timeB - timeA;
        }
        return 0;
      });
  }, [allStudents, documentSearch, documentModal]);

  const toggleDocumentStudent = useCallback((id, checked) => setDocumentSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)), []);
  const selectAllDocumentStudents = useCallback(() => setDocumentSelectedIds(documentStudents.map((student) => student._id)), [documentStudents]);

  const startDocumentGeneration = useCallback(async (renderMode = null) => {
    // This function is also invoked from a button. Accept only the two
    // supported string values so a React click event can never enter state.
    const selectedRenderMode = renderMode === "template" || renderMode === "full"
      ? renderMode
      : null;
    if (!documentSelectedIds.length) return setDocumentError("Select at least one student.");
    if (documentModal === "certificate" && !selectedRenderMode) {
      setDocumentOutputChoice(true);
      return;
    }
    setDocumentOutputChoice(false);
    setDocumentRenderMode(selectedRenderMode || "full");
    setDocumentBusy(true); setDocumentError("");
    try {
      if (documentModal === "ism") {
        const groups = documentSelectedIds.reduce((result, id) => {
          const student = allStudents.find((item) => item._id === id);
          const division = student?.trainingManagement?.division?.trim();
          if (!division) throw new Error("Every selected student needs an allocated division before an ISM can be generated.");
          (result[division] ||= []).push(id);
          return result;
        }, {});
        const generated = [];
        for (const ids of Object.values(groups)) generated.push(await createGyapanPreview({ ids }));
        setDocumentQueue(generated);
      } else {
        setDocumentQueue(documentSelectedIds.map((id) => ({ student: allStudents.find((item) => item._id === id) })));
      }
      setDocumentIndex(0);
    } catch (err) { setDocumentError(err.message); }
    finally { setDocumentBusy(false); }
  }, [allStudents, documentModal, documentSelectedIds]);

  const prepareCertificate = useCallback(async () => {
    const student = documentQueue[documentIndex]?.student;
    if (!student) return;
    setDocumentBusy(true); setDocumentError("");
    try {
      const { blob, filename } = await downloadCertificates(
        [student._id],
        "certificates",
        documentRenderMode,
        signature?.name || "",
        signature?.designation || ""
      );
      const pdfUrl = await createPdfUrl(blob);

      setCertificatePreview({ url: pdfUrl, filename });
    } catch (err) {
      const detail = import.meta.env.DEV ? ` ${err.message}` : "";
      setDocumentError(`Unable to generate certificate for ${student.name}.${detail}`);
    }
    finally { setDocumentBusy(false); }
  }, [documentIndex, documentQueue, documentRenderMode, signature]);

  const openSignatureEditor = () => { setSignatureDraft(signature || { name: "VAIBHAV GUPTA", designation: "TECHNICAL OFFICER 'C'" }); setSignatureError(""); setSignatureEditorOpen(true); };
  const saveSignature = () => {
    const name = signatureDraft.name.trim();
    const designation = signatureDraft.designation.trim();
    if (!name) {
      setSignatureError("Name is required.");
      return;
    }
    if (!designation) {
      setSignatureError("Designation is required.");
      return;
    }
    setSignature({ name, designation });
    setSignatureEditorOpen(false);
    if (certificatePreview?.url) URL.revokeObjectURL(certificatePreview.url);
    setCertificatePreview(null);
  };

  const downloadCertificate = useCallback(() => {
    if (!certificatePreview) return;
    const student = documentQueue[documentIndex]?.student;
    if (!student) return;
    const refId = student.referenceId || "UNKNOWN";
    const nameNoSpaces = (student.name || "Student").replace(/\s+/g, "");
    const link = document.createElement("a");
    link.href = certificatePreview.url;
    link.download = `Certificate_${refId}_${nameNoSpaces}.pdf`;
    link.click();
    const studentId = student._id;
    if (studentId) {
      setCertificateDownloadedIds((current) => {
        const next = [...new Set([...current, studentId])];
        localStorage.setItem(CERTIFICATE_DOWNLOADS_KEY, JSON.stringify(next));
        return next;
      });
    }
  }, [certificatePreview, documentIndex, documentQueue]);

  const downloadIsm = useCallback(async () => {
    const item = documentQueue[documentIndex];
    if (!item?.gyapan?._id) return;
    setDocumentBusy(true); setDocumentError("");
    try {
      const result = await generateGyapanPdf(item.gyapan._id);
      const presignedUrl = await getPresignedFileUrl(result.pdfUrl, "admin");
      const response = await fetch(presignedUrl);
      const blob = await readDocumentResponse(response);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const firstStudentId = item.gyapan.selectedStudents?.[0];
      const student = allStudents.find((s) => s._id === firstStudentId) || {};
      const refId = student.referenceId || "UNKNOWN";
      const nameNoSpaces = (student.name || "Student").replace(/\s+/g, "");
      link.download = `ISM_${refId}_${nameNoSpaces}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);

      const studentIds = item.gyapan.selectedStudents || [];
      if (studentIds.length) {
        setIsmDownloadedIds((current) => {
          const next = [...new Set([...current, ...studentIds])];
          localStorage.setItem(ISM_DOWNLOADS_KEY, JSON.stringify(next));
          return next;
        });
      }
    } catch (err) { setDocumentError(err.message || "Unable to download ISM."); }
    finally { setDocumentBusy(false); }
  }, [documentIndex, documentQueue, allStudents]);

  const getProformaHtml = useCallback((forExport = false) => {
    const approvedPaidCount = administration?.paidSeatLimit ?? 0;

    const rowsHtml = proformaStudents
      .map((s, index) => {
        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.discipline)}</td>
            <td>${escapeHtml(s.gender)}</td>
            <td>${escapeHtml(s.dob)}</td>
            <td>${escapeHtml(s.joiningDate)}</td>
            <td>${escapeHtml(s.projectName)}</td>
            <td>${escapeHtml(s.designationTitle)}</td>
            <td>${escapeHtml(s.supervisorName)}</td>
            <td>${escapeHtml(s.projectNameAndPdc)}</td>
            <td>${escapeHtml(s.achievements)}</td>
            <td>${escapeHtml(s.completionDate)}</td>
            <td>${escapeHtml(s.resignationDate)}</td>
            <td>${escapeHtml(s.remarks)}</td>
          </tr>
        `;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Proforma for Quarterly Report in R/O DRDO Paid Internship Scheme</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            margin: 10px;
            color: #000;
        }

        .title {
            text-align: center;
            font-weight: bold;
            font-size: 13px;
            margin-bottom: 10px;
            text-decoration: underline;
        }

        .sub-title {
            text-align: right;
            font-size: 10px;
            margin-bottom: 10px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
        }

        th, td {
            border: 1px solid #000;
            padding: 3px 4px;
            text-align: left;
            vertical-align: top;
        }

        th {
            background-color: #f2f2f2;
            text-align: center;
        }

        .center {
            text-align: center;
        }

        .right {
            text-align: right;
        }
    </style>
</head>
<body>

    <div class="title">
        PROFORMA FOR QUARTERLY REPORT IN R/O DRDO PAID INTERNSHIP SCHEME
    </div>

    <div class="sub-title">
        To be maintained at DG Cluster / Lab Level
    </div>

    <table>
        <thead>
            <tr>
                <th colspan="10" style="text-align: left; background: none; border: none; padding: 10px 0;">
                    <h3>Quarterly report for quarter ending: ${escapeHtml(proformaQuarterEnding || "........")}</h3>
                    <h3>1. BRIEF OF REPORT:</h3>
                </th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td colspan="5"></td>
                <td>DG Cluster</td>
                <td colspan="2">Lab / Estt</td>
                <td colspan="2">Remark</td>
            </tr>

            <tr>
                <td colspan="4">A</td>
                <td>Authorization of Intern:</td>
                <td class="center">Total students = ${approvedPaidCount}</td>
                <td colspan="2" class="center">IRDE</td>
                <td colspan="2"></td>
            </tr>

            <tr>
                <td colspan="4">B</td>
                <td>
                    Held Strength of Intern / candidate:<br>
                    (i) Engaged in Projects<br>
                    (ii) Engaged in other R&D activity
                </td>
                <td class="center">${escapeHtml(proformaSection1.B_dg_cluster)}</td>
                <td colspan="2" class="center">${escapeHtml(proformaSection1.B_lab)}</td>
                <td colspan="2">${escapeHtml(proformaSection1.B_remark)}</td>
            </tr>

            <tr>
                <td colspan="4">C</td>
                <td>
                    Vacant Intern / Candidate:<br>
                    (i) Under selection and likely to be engaged in Project / R&D activity<br>
                    (ii) Not under selection
                </td>
                <td class="center">${escapeHtml(proformaSection1.C_dg_cluster)}</td>
                <td colspan="2" class="center">${escapeHtml(proformaSection1.C_lab)}</td>
                <td colspan="2">${escapeHtml(proformaSection1.C_remark)}</td>
            </tr>

            <tr>
                <td colspan="4">D</td>
                <td>Internship awarded in the reporting period:</td>
                <td class="center">${escapeHtml(proformaSection1.D_dg_cluster)}</td>
                <td colspan="2" class="center">${escapeHtml(proformaSection1.D_lab)}</td>
                <td colspan="2">${escapeHtml(proformaSection1.D_remark)}</td>
            </tr>

            <tr>
                <td colspan="4">E</td>
                <td>Intern / candidate resigned / terminated in the reporting period:</td>
                <td class="center">${escapeHtml(proformaSection1.E_dg_cluster)}</td>
                <td colspan="2" class="center">${escapeHtml(proformaSection1.E_lab)}</td>
                <td colspan="2">${escapeHtml(proformaSection1.E_remark)}</td>
            </tr>

            <tr>
                <td colspan="4">F</td>
                <td>Details of achievement:</td>
                <td class="center">${escapeHtml(proformaSection1.F_dg_cluster)}</td>
                <td colspan="2" class="center">${escapeHtml(proformaSection1.F_lab)}</td>
                <td colspan="2">${escapeHtml(proformaSection1.F_remark)}</td>
            </tr>
        </tbody>
    </table>

    <br>

    <table>
        <thead>
            <tr>
                <th colspan="14" style="text-align: left; background: none; border: none; padding: 10px 0;">
                    <h3>2. DETAILS IN R/O EACH INTERN:</h3>
                </th>
            </tr>
            <tr>
                <th>S.No</th>
                <th>Name of Intern</th>
                <th>Discipline</th>
                <th>Gender</th>
                <th>Date of Birth</th>
                <th>Date of joining the Lab</th>
                <th>Name of Project</th>
                <th>Title of assignment</th>
                <th>Name of the Supervisor</th>
                <th>Name & PDC of the Project in which working</th>
                <th>Achievements</th>
                <th>Date of Completion of internship</th>
                <th>Date of Resignation, if applicable</th>
                <th>Remarks</th>
            </tr>
            <tr class="center">
                <td style="mso-number-format:\@;"></td>
                <td style="mso-number-format:\@;">&nbsp;(1)</td>
                <td style="mso-number-format:\@;">&nbsp;(2)</td>
                <td style="mso-number-format:\@;">&nbsp;(3)</td>
                <td style="mso-number-format:\@;">&nbsp;(4)</td>
                <td style="mso-number-format:\@;">&nbsp;(5)</td>
                <td style="mso-number-format:\@;">&nbsp;(6)</td>
                <td style="mso-number-format:\@;">&nbsp;(7)</td>
                <td style="mso-number-format:\@;">&nbsp;(8)</td>
                <td style="mso-number-format:\@;">&nbsp;(9)</td>
                <td style="mso-number-format:\@;">&nbsp;(10)</td>
                <td style="mso-number-format:\@;">&nbsp;(11)</td>
                <td style="mso-number-format:\@;">&nbsp;(12)</td>
                <td style="mso-number-format:\@;">&nbsp;(13)</td>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml || '<tr><td colspan="14" class="center">No student records found.</td></tr>'}
        </tbody>
    </table>

</body>
</html>`;
  }, [allStudents, proformaQuarterEnding, proformaSection1, proformaStudents, administration]);

  const downloadProformaExcel = useCallback(() => {
    const htmlContent = getProformaHtml(true);
    const blob = new Blob(["\ufeff", htmlContent], { type: "application/vnd.ms-excel;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Proforma_Quarterly_Report.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, [getProformaHtml]);

  const handleProformaPrint = useCallback(() => {
    const htmlContent = getProformaHtml(true);
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    printFrame.contentWindow.document.write(htmlContent);
    printFrame.contentWindow.document.close();
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();

    setTimeout(() => {
      if (printFrame.parentNode) {
        document.body.removeChild(printFrame);
      }
    }, 2000);
  }, [getProformaHtml]);

  const getAttendanceReportHtml = useCallback((fromDate, toDate, quarter) => {
    const approvedPaidStudents = allStudents.filter(
      (s) => {
        if (s.status !== "Approved" || s.internshipType !== "Paid") return false;
        const joining = s.trainingManagement?.fromDate || "";
        if (fromDate && toDate) {
          return joining >= fromDate && joining <= toDate;
        }
        return true;
      }
    );

    const rowsHtml = approvedPaidStudents
      .map((student, index) => {
        const report = quarter === 1 ? student.firstQuarterReport : student.secondQuarterReport;
        const bank = student.bankDetails || {};

        let period = "-";
        if (report?.fromDate && report?.toDate) {
          period = `${formatReportDate(report.fromDate)} - ${formatReportDate(report.toDate)}`;
        }

        const days = report?.daysPresent !== undefined && report?.daysPresent !== "" ? report.daysPresent : "-";

        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(student.name)}</td>
            <td class="center">${escapeHtml(period)}</td>
            <td class="center">${escapeHtml(days)}</td>
            <td>${escapeHtml(bank.bankName || "-")}</td>
            <td>${escapeHtml(bank.savingAccountNumber || "-")}</td>
            <td>${escapeHtml(bank.ifsc || "-")}</td>
          </tr>
        `;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Attendance Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            margin: 20px;
            color: #000;
        }

        .header-container {
            text-align: right;
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 15px;
        }

        .title {
            text-align: center;
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 20px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
        }

        th, td {
            border: 1px solid #000;
            padding: 6px 8px;
            text-align: left;
            vertical-align: middle;
        }

        th {
            background-color: #f2f2f2;
            text-align: center;
        }

        .center {
            text-align: center;
        }

        .right {
            text-align: right;
        }
    </style>
</head>
<body>

    <div class="title">
        Attendance Report for period ${formatReportDate(fromDate)} - ${formatReportDate(toDate)}
    </div>

    <table>
        <thead>
            <tr>
                <th>SRNO</th>
                <th>STUDENT NAME</th>
                <th>PERIOD</th>
                <th>No. of Present (DAYS)</th>
                <th>BANK NAME</th>
                <th>Saving A/c no</th>
                <th>IFSC</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml || '<tr><td colspan="7" class="center">No student records found.</td></tr>'}
        </tbody>
    </table>

</body>
</html>`;
  }, [allStudents]);

  const downloadExcel = useCallback((fromDate, toDate, quarter) => {
    const approvedPaidStudents = allStudents.filter(
      (s) => {
        if (s.status !== "Approved" || s.internshipType !== "Paid") return false;
        const joining = s.trainingManagement?.fromDate || "";
        if (fromDate && toDate) {
          return joining >= fromDate && joining <= toDate;
        }
        return true;
      }
    );
    const headers = ["SRNO", "STUDENT NAME", "PERIOD", "No. of Present (DAYS)", "BANK NAME", "Saving A/c no", "IFSC"];
    const rows = approvedPaidStudents.map((student, index) => {
      const report = quarter === 1 ? student.firstQuarterReport : student.secondQuarterReport;
      const bank = student.bankDetails || {};
      let period = "-";
      if (report?.fromDate && report?.toDate) {
        period = `${formatReportDate(report.fromDate)} - ${formatReportDate(report.toDate)}`;
      }
      const days = report?.daysPresent !== undefined && report?.daysPresent !== "" ? report.daysPresent : "-";
      return [
        index + 1,
        student.name,
        period,
        days,
        bank.bankName || "-",
        bank.savingAccountNumber || "-",
        bank.ifsc || "-"
      ];
    });

    const csvContent = [headers.join(","), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\r\n");
    const blob = new Blob(["\ufeff", csvContent], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Attendance_Report_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, [allStudents]);

  const handleDownloadPdf = useCallback(async (fromDate, toDate, quarter) => {
    try {
      const htmlContent = getAttendanceReportHtml(fromDate, toDate, quarter);
      const blob = await downloadAttendanceReportPdf(htmlContent);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Attendance_Report_${fromDate}_to_${toDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download PDF: " + err.message);
    }
  }, [getAttendanceReportHtml]);

  const handlePrint = useCallback((fromDate, toDate, quarter) => {
    const htmlContent = getAttendanceReportHtml(fromDate, toDate, quarter);
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    printFrame.contentWindow.document.write(htmlContent);
    printFrame.contentWindow.document.close();
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();

    setTimeout(() => {
      if (printFrame.parentNode) {
        document.body.removeChild(printFrame);
      }
    }, 2000);
  }, [getAttendanceReportHtml]);

  const updateSection1 = (key, value) => {
    setProformaSection1((prev) => ({ ...prev, [key]: value }));
  };

  const updateStudentRow = (index, field, value) => {
    setProformaStudents((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const generateProformaReport = async () => {
    if (!proformaFromDate || !proformaToDate) {
      alert("Please select a valid From Date and To Date.");
      return;
    }
    if (new Date(proformaFromDate) > new Date(proformaToDate)) {
      alert("Please select a valid From Date and To Date.");
      return;
    }
    try {
      await saveProformaConfig({
        proformaSelectedPeriod: { fromDate: proformaFromDate, toDate: proformaToDate }
      });
      const response = await fetchAdminStudents({
        isQuarterlyReport: "true",
        fromDate: proformaFromDate,
        toDate: proformaToDate
      });

      const paidApprovedStudents = response.students.filter(s => s.status === "Approved" && s.internshipType === "Paid");
      const filteredStudents = paidApprovedStudents.filter(s => {
        const joining = s.trainingManagement?.fromDate || "";
        return joining >= proformaFromDate && joining <= proformaToDate;
      });
      setAllStudents(response.students);
      setProformaGenerated(true);
    } catch (err) {
      alert("Failed to save selected period: " + err.message);
    }
  };

  const generateAttendanceReport = async () => {
    if (!attendanceFromDate || !attendanceToDate) {
      alert("Please select a valid From Date and To Date.");
      return;
    }
    if (new Date(attendanceFromDate) > new Date(attendanceToDate)) {
      alert("Please select a valid From Date and To Date.");
      return;
    }
    try {
      await saveProformaConfig({
        attendanceSelectedPeriod: { fromDate: attendanceFromDate, toDate: attendanceToDate }
      });
      const response = await fetchAdminStudents({
        isQuarterlyReport: "true",
        fromDate: attendanceFromDate,
        toDate: attendanceToDate
      });

      const paidApprovedStudents = response.students.filter(s => s.status === "Approved" && s.internshipType === "Paid");
      const filteredStudents = paidApprovedStudents.filter(s => {
        const joining = s.trainingManagement?.fromDate || "";
        return joining >= attendanceFromDate && joining <= attendanceToDate;
      });
      setAllStudents(response.students);
      setAttendanceGenerated(true);
    } catch (err) {
      alert("Failed to save selected period: " + err.message);
    }
  };

  const [isSavingProforma, setIsSavingProforma] = useState(false);

  const saveProformaChanges = async () => {
    setIsSavingProforma(true);
    try {
      const parseDateInput = (val) => {
        if (!val || val === "-" || String(val).trim() === "") return null;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
          const [d, m, y] = val.split("/");
          return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return val;
        }
        const matchStr = String(val).trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
        if (matchStr) {
          const day = matchStr[1].padStart(2, '0');
          const monthStr = matchStr[2].toLowerCase();
          const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
          const monthIdx = months.indexOf(monthStr);
          if (monthIdx !== -1) {
            const month = String(monthIdx + 1).padStart(2, '0');
            const year = matchStr[3];
            return `${year}-${month}-${day}`;
          }
        }
        const parsed = new Date(val);
        if (!isNaN(parsed.getTime())) {
          const y = parsed.getFullYear();
          const m = String(parsed.getMonth() + 1).padStart(2, '0');
          const d = String(parsed.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        return val;
      };

      for (const s of proformaStudents) {
        let course = s.discipline || "";
        let branch = "";
        if (s.discipline && s.discipline.includes(" - ")) {
          const parts = s.discipline.split(" - ");
          course = parts[0].trim();
          branch = parts.slice(1).join(" - ").trim();
        }

        const payload = {
          name: s.name,
          gender: s.gender,
          course,
          branch,
          dob: parseDateInput(s.dob),
          trainingManagement: {
            fromDate: parseDateInput(s.joiningDate),
            toDate: parseDateInput(s.completionDate),
            remarks: s.remarks,
          },
          paidInternshipProjectDetails: {
            projectName: s.projectName,
            designationTitle: s.designationTitle,
            supervisorName: s.supervisorName,
            projectNameAndPdc: s.projectNameAndPdc,
            achievements: s.achievements,
          }
        };

        if (s.resignationDate && s.resignationDate !== "-") {
          payload.resignationStatus = "Yes";
          payload.resignationDate = parseDateInput(s.resignationDate);
        } else {
          payload.resignationStatus = "No";
          payload.resignationDate = null;
        }

        await updateStudentReview(s._id, payload);
      }

      await saveProformaConfig({
        reportPeriod: `${proformaFromDate}_${proformaToDate}`,
        proformaQuarterEnding,
        proformaSection1
      });

      alert("Proforma changes saved successfully!");
      await loadAll();
    } catch (err) {
      alert("Failed to save changes: " + err.message);
    } finally {
      setIsSavingProforma(false);
    }
  };

  const updateAttendanceStudent = (studentId, field, value, quarter) => {
    setAllStudents((prev) =>
      prev.map((s) => {
        if (s._id !== studentId) return s;
        const updated = { ...s };
        if (field === "bankName" || field === "savingAccountNumber" || field === "ifsc") {
          updated.bankDetails = {
            ...(updated.bankDetails || {}),
            [field]: value
          };
        } else if (field === "daysPresent") {
          const slot = quarter === 1 ? "firstQuarterReport" : "secondQuarterReport";
          updated[slot] = {
            ...(updated[slot] || {}),
            daysPresent: value
          };
        }
        return updated;
      })
    );
  };

  const saveAttendanceChanges = async (fromDate, toDate, quarter) => {
    setIsSavingProforma(true);
    try {
      const approvedPaidStudents = allStudents.filter(
        (s) => s.status === "Approved" && s.internshipType === "Paid"
      );

      const parseDateInput = (val) => {
        if (!val || val === "-" || String(val).trim() === "") return "";
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
          const [d, m, y] = val.split("/");
          return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return val;
        }
        const parsed = new Date(val);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().slice(0, 10);
        }
        return val;
      };

      const slot = quarter === 1 ? "firstQuarterReport" : "secondQuarterReport";

      for (const s of approvedPaidStudents) {
        const report = s[slot] || {};

        const payload = {
          bankDetails: s.bankDetails || {},
          [slot]: {
            fromDate: parseDateInput(report.fromDate),
            toDate: parseDateInput(report.toDate),
            daysPresent: report.daysPresent || "",
          }
        };

        await updateStudentReview(s._id, payload);
      }
      alert("Attendance changes saved successfully!");
      await loadAll();
    } catch (err) {
      alert("Failed to save changes: " + err.message);
    } finally {
      setIsSavingProforma(false);
    }
  };

  const renderAttendanceReportTable = (fromDate, toDate, quarter) => {
    const approvedPaidStudents = allStudents.filter(
      (s) => {
        if (s.status !== "Approved" || s.internshipType !== "Paid") return false;
        const joining = s.trainingManagement?.fromDate || "";
        if (fromDate && toDate) {
          return joining >= fromDate && joining <= toDate;
        }
        return true;
      }
    );

    return (
      <div style={{ marginTop: "24px", background: "#fff", padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
        <h3 style={{ textAlign: "center", marginBottom: "20px" }}>Attendance Report for period {formatReportDate(fromDate)} - {formatReportDate(toDate)}</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", color: "#000" }}>
            <thead>
              <tr style={{ backgroundColor: "#f2f2f2" }}>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "center" }}>SRNO</th>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>STUDENT NAME</th>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "center" }}>PERIOD</th>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "center" }}>No. of Present (DAYS)</th>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>BANK NAME</th>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>Saving A/c no</th>
                <th style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>IFSC</th>
              </tr>
            </thead>
            <tbody>
              {approvedPaidStudents.length > 0 ? (
                approvedPaidStudents.map((student, index) => {
                  const report = quarter === 1 ? student.firstQuarterReport : student.secondQuarterReport;
                  const bank = student.bankDetails || {};
                  const periodText = report?.fromDate && report?.toDate
                    ? `${formatReportDate(report.fromDate)} - ${formatReportDate(report.toDate)}`
                    : "-";
                  return (
                    <tr key={student._id}>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "center" }}>{index + 1}</td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>{student.name}</td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "center" }}>{periodText}</td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "center" }}>
                        <input
                          type="text"
                          value={report?.daysPresent || ""}
                          onChange={(e) => updateAttendanceStudent(student._id, "daysPresent", e.target.value, quarter)}
                          style={{ border: "1px dashed #ccc", padding: "2px", fontSize: "11px", width: "60px", textAlign: "center" }}
                        />
                      </td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>
                        <input
                          type="text"
                          value={bank.bankName || ""}
                          onChange={(e) => updateAttendanceStudent(student._id, "bankName", e.target.value, quarter)}
                          style={{ border: "1px dashed #ccc", padding: "2px", fontSize: "11px", width: "100%" }}
                        />
                      </td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>
                        <input
                          type="text"
                          value={bank.savingAccountNumber || ""}
                          onChange={(e) => updateAttendanceStudent(student._id, "savingAccountNumber", e.target.value, quarter)}
                          style={{ border: "1px dashed #ccc", padding: "2px", fontSize: "11px", width: "100%" }}
                        />
                      </td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", textAlign: "left" }}>
                        <input
                          type="text"
                          value={bank.ifsc || ""}
                          onChange={(e) => updateAttendanceStudent(student._id, "ifsc", e.target.value, quarter)}
                          style={{ border: "1px dashed #ccc", padding: "2px", fontSize: "11px", width: "100%" }}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" style={{ border: "1px solid #000", padding: "12px", textAlign: "center" }}>No student records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const openAdministration = useCallback(() => {
    window.history.pushState({}, "", "/admin/system-configuration");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);
  const openCollegeManagement = useCallback(() => {
    window.history.pushState({}, "", "/admin/management");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);
  const openProfile = useCallback(() => {
    window.history.pushState({}, "", "/admin/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const toggleSelected = useCallback((id, checked) => {
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id)
    );
  }, []);

  const toggleDeleteMode = useCallback(() => {
    setDeleteMode((current) => {
      if (current) setSelectedIds([]);
      return !current;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (!selectedIds.length) {
      setError("Select one or more registrations to delete.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete selected student(s)?\nThis action cannot be undone.")) return;

    try {
      await deleteAdminStudents(selectedIds);
      const response = await fetchAdminStudents(query);
      setStudents(response.students);
      setSummary(response.summary);
      setAllStudents(response.students);
      setSelectedIds([]);
      setDeleteMode(false);
      window.dispatchEvent(new Event("student-division-updated"));
    } catch (err) {
      setError(err.message);
    }
  }, [selectedIds, query]);

  const handleStatusChange = useCallback((id, updatedStudent) => {
    setAllStudents((current) => {
      const oldStudent = current.find((s) => s._id === id);
      const oldStatus = oldStudent?.status;
      const newStatus = updatedStudent.status;
      if (oldStatus !== newStatus) {
        setSummary((prev) => {
          if (!prev) return prev;
          let approvedDiff = 0;
          if (oldStatus === "Approved") approvedDiff -= 1;
          if (newStatus === "Approved") approvedDiff += 1;
          return {
            ...prev,
            approvedStudents: Math.max(0, (prev.approvedStudents || 0) + approvedDiff),
          };
        });
      }
      return current.map((s) => (s._id === id ? { ...s, ...updatedStudent } : s));
    });
    setStudents((current) =>
      current.map((s) => (s._id === id ? { ...s, ...updatedStudent } : s))
    );
    window.dispatchEvent(new Event("student-division-updated"));
  }, []);

  // Student Management Client-side Filter Options
  const collegesList = useMemo(() => {
    return [...new Set(allStudents.map(s => s.collegeName).filter(Boolean))].sort();
  }, [allStudents]);

  const courseList = useMemo(() => {
    return [...new Set(allStudents.map(s => s.course).filter(Boolean))].sort();
  }, [allStudents]);

  const branchList = useMemo(() => {
    return [...new Set(allStudents.map(s => s.branch).filter(Boolean))].sort();
  }, [allStudents]);

  const yearList = useMemo(() => {
    return [...new Set(allStudents.map(s => s.year).filter(Boolean))].sort();
  }, [allStudents]);

  const internshipStudents = useMemo(() => {
    if (internshipTypeFilter === "all") return allStudents;
    if (internshipTypeFilter === "paid") {
      return allStudents.filter(s => s.internshipType === "Paid");
    }
    return allStudents.filter(s => s.internshipType === "Unpaid" || !s.internshipType);
  }, [allStudents, internshipTypeFilter]);

  const filteredStudents = useMemo(() => {
    return internshipStudents.filter((student) => {
      if (search.trim()) {
        const term = search.toLowerCase();
        const matchesSearch =
          student.name?.toLowerCase().includes(term) ||
          student.referenceId?.toLowerCase().includes(term) ||
          student.email?.toLowerCase().includes(term) ||
          student.phone?.toLowerCase().includes(term) ||
          student.collegeName?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }
      return true;
    });
  }, [internshipStudents, search]);

  const sortedStudents = useMemo(() => {
    const list = [...filteredStudents];
    if (sort.sortBy) {
      list.sort((a, b) => {
        let left = a[sort.sortBy] || "";
        let right = b[sort.sortBy] || "";
        if (sort.sortBy === "college") {
          left = a.collegeName || "";
          right = b.collegeName || "";
        }
        if (sort.sortBy === "name") {
          left = a.name || "";
          right = b.name || "";
        }
        if (typeof left === "string") left = left.toLowerCase();
        if (typeof right === "string") right = right.toLowerCase();
        if (left < right) return sort.sortOrder === "asc" ? -1 : 1;
        if (left > right) return sort.sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }
    return list;
  }, [filteredStudents, sort]);

  // --- Inline Status Dropdown (Student Management only) ---
  const STATUS_COLORS = {
    Pending: { background: "#fef9c3", color: "#854d0e", border: "#fde68a" },
    Approved: { background: "#dcfce7", color: "#14532d", border: "#86efac" },
    Rejected: { background: "#fee2e2", color: "#7f1d1d", border: "#fca5a5" },
  };

  const handleStatusDropdownChange = (e, student) => {
    e.stopPropagation();
    const newStatus = e.target.value;
    if (newStatus === student.status) return;
    setStatusConfirm({ studentId: student._id, oldStatus: student.status, newStatus });
  };

  const confirmStatusChange = async () => {
    if (!statusConfirm) return;
    const { studentId, newStatus } = statusConfirm;
    setStatusUpdating(studentId);
    setStatusConfirm(null);
    try {
      await updateStudentReview(studentId, { status: newStatus });
      // Update allStudents in-place so the row refreshes immediately
      setAllStudents(prev =>
        prev.map(s => s._id === studentId ? { ...s, status: newStatus } : s)
      );
      window.dispatchEvent(new Event("student-division-updated"));
    } catch (err) {
      alert("Failed to update status: " + (err.message || "Unknown error"));
    } finally {
      setStatusUpdating(null);
    }
  };

  const handleSortClick = (field) => {
    setSort((prev) => {
      const order = prev.sortBy === field && prev.sortOrder === "asc" ? "desc" : "asc";
      return { sortBy: field, sortOrder: order };
    });
  };
  const processOfferLetter = async (action) => {
    const studentId = offerLetterQueue[0];
    if (!studentId) return;
    const student = students.find((item) => item._id === studentId);
    setOfferLetterBusy(true);
    try {
      if (action !== "skip") {
        const blob = await downloadOfferLetterPdf(studentId);
        if (offerLetterAction === "print") {
          printPdf(blob);
        } else {
          const url = await createPdfUrl(blob);
          const refId = (student?.referenceId || "UNKNOWN").replace(/[^a-zA-Z0-9_-]/g, "");
          const nameNoSpaces = (student?.name || "Student").replace(/\s+/g, "").replace(/[^a-zA-Z0-9_-]/g, "");
          const link = document.createElement("a");
          link.href = url;
          link.download = `OfferLetter_${refId}_${nameNoSpaces}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } else {
      }
      setOfferLetterIds((current) => current.filter((id) => id !== studentId));
    } catch (err) {
      setError(err.message || "Unable to generate offer letter.");
    } finally {
      setOfferLetterBusy(false);
      setOfferLetterQueue((current) => {
        const nextQueue = current.slice(1);
        if (nextQueue.length === 0) {
          setOfferLetterMode(false);
          setOfferLetterAction("");
          setOfferLetterIds([]);
        }
        return nextQueue;
      });
    }
  };
  const startOfferLetterWorkflow = (action) => { setOfferLetterAction(action); setOfferLetterQueue([...offerLetterIds]); };
  const cancelOfferLetterWorkflow = () => { setOfferLetterQueue([]); setOfferLetterIds([]); setOfferLetterAction(""); setOfferLetterMode(false); };
  const stopOfferLetterWorkflow = () => { setOfferLetterQueue([]); setOfferLetterAction(""); };
  const visibleManagementColumns = MANAGEMENT_COLUMNS.filter(([key]) => managementFields.includes(key));
  const toggleManagementField = (key) => setManagementFields((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);

  return (
    <main className="admin-console admin-shell">
      {/* Dynamic Header */}
      <header className="admin-topbar">
        <div>
          <p className="portal-eyebrow">Admin Panel</p>
          <h1>
            {currentView === "home" && "Dashboard Home"}
            {currentView === "student-management" && "Student Management"}
            {currentView === "approved-students" && "Approved Students"}
            {currentView === "administration" && "Administration Options"}
            {currentView === "quarterly-reports" && "Quarterly Reports"}
          </h1>
        </div>
        <div className="admin-topbar__actions">
          {currentView === "approved-students" && (
            <button className="admin-secondary-btn" type="button" onClick={openAdministration}>
              System Configurations
            </button>
          )}
          {currentView !== "home" && (
            <button className="admin-secondary-btn" type="button" onClick={handleGoHomeWithCheck}>
              🏠 Home
            </button>
          )}
          <button className="admin-secondary-btn" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* VIEW 1: Home View */}
      {currentView === "home" && (
        <div className="admin-dashboard-home-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginTop: "40px" }}>
          <div className="admin-summary-card admin-summary-card--interactive" onClick={() => handleSwitchViewWithCheck("student-management")} style={{ cursor: "pointer", padding: "32px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", transition: "transform 0.2s, box-shadow 0.2s" }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>📋 Student Management</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Register new students and manage student files, statuses, and profiles.</p>
          </div>
          <div className="admin-summary-card admin-summary-card--interactive" onClick={() => handleSwitchViewWithCheck("approved-students")} style={{ cursor: "pointer", padding: "32px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", transition: "transform 0.2s, box-shadow 0.2s" }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>✅ Approved Students</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Generate offer letters, print completion certificates, and verify joining details.</p>
          </div>
          <div className="admin-summary-card admin-summary-card--interactive" onClick={() => handleSwitchViewWithCheck("administration")} style={{ cursor: "pointer", padding: "32px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", transition: "transform 0.2s, box-shadow 0.2s" }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>⚙️ Administration</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Manage divisions, system configurations, list colleges, and edit admin profile.</p>
          </div>
          <div className="admin-summary-card admin-summary-card--interactive" onClick={() => { window.history.pushState({}, "", "/admin/reports"); window.dispatchEvent(new PopStateEvent("popstate")); }} style={{ cursor: "pointer", padding: "32px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", transition: "transform 0.2s, box-shadow 0.2s" }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>📊 Reports</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Filter approved, joined, and completed students and export a tailored report.</p>
          </div>
          <div className="admin-summary-card admin-summary-card--interactive" onClick={() => handleSwitchViewWithCheck("quarterly-reports")} style={{ cursor: "pointer", padding: "32px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", transition: "transform 0.2s, box-shadow 0.2s" }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>📅 Quarterly Reports</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Open Proforma for Quarterly Reports and Attendance Reports.</p>
          </div>
        </div>
      )}

      {/* VIEW 5: Quarterly Reports View */}
      {currentView === "quarterly-reports" && (
        <div style={{ padding: "24px 0" }}>
          {quarterlySubView === "menu" && (
            <div className="admin-dashboard-home-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginTop: "20px" }}>
              <div className="admin-summary-card" style={{ padding: "32px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "16px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>📝 Proforma for Quarterly Report</h2>
                  <p style={{ margin: "8px 0 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>Open the module for Quarterly Report Proformas.</p>
                </div>
                <button className="admin-primary-btn" type="button" onClick={() => setQuarterlySubView("proforma")} style={{ width: "fit-content", padding: "8px 24px", height: "auto" }}>Open</button>
              </div>
              <div className="admin-summary-card" style={{ padding: "32px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "16px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>📅 Attendance Report</h2>
                  <p style={{ margin: "8px 0 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>Open the module for Attendance Reports.</p>
                </div>
                <button className="admin-primary-btn" type="button" onClick={() => setQuarterlySubView("attendance")} style={{ width: "fit-content", padding: "8px 24px", height: "auto" }}>Open</button>
              </div>
            </div>
          )}

          {quarterlySubView === "attendance" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <h2 style={{ margin: 0 }}>Attendance Report</h2>
                <button className="admin-secondary-btn" type="button" onClick={() => setQuarterlySubView("menu")}>Back</button>
              </div>
              <div className="admin-dashboard-home-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginTop: "20px" }}>
                <div className="admin-summary-card" style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "16px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
                  <h3 style={{ margin: 0, color: "var(--primary)" }}>First Quarter Report</h3>
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>Open attendance report for the first 3 months.</p>
                  <button className="admin-primary-btn" type="button" onClick={() => setQuarterlySubView("first-quarter")} style={{ width: "fit-content", padding: "8px 24px", height: "auto" }}>Open</button>
                </div>
                <div className="admin-summary-card" style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "16px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
                  <h3 style={{ margin: 0, color: "var(--primary)" }}>Second Quarter Report</h3>
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>Open attendance report for the second 3 months.</p>
                  <button className="admin-primary-btn" type="button" onClick={() => setQuarterlySubView("second-quarter")} style={{ width: "fit-content", padding: "8px 24px", height: "auto" }}>Open</button>
                </div>
              </div>
            </div>
          )}

          {quarterlySubView === "first-quarter" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <h2 style={{ margin: 0 }}>First Quarter Attendance Report</h2>
                <div style={{ display: "flex", gap: "12px" }}>
                  {attendanceGenerated && (
                    <>
                      <button className="admin-primary-btn" type="button" onClick={() => saveAttendanceChanges(attendanceFromDate, attendanceToDate, 1)} disabled={isSavingProforma}>{isSavingProforma ? "Saving..." : "Save Changes"}</button>
                      <button className="admin-primary-btn" type="button" onClick={() => downloadExcel(attendanceFromDate, attendanceToDate, 1)}>Download Excel</button>
                      <button className="admin-primary-btn" type="button" onClick={() => handleDownloadPdf(attendanceFromDate, attendanceToDate, 1)}>Download PDF</button>
                      <button className="admin-primary-btn" type="button" onClick={() => handlePrint(attendanceFromDate, attendanceToDate, 1)}>Print</button>
                    </>
                  )}
                  <button className="admin-secondary-btn" type="button" onClick={() => setQuarterlySubView("attendance")}>Back</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px", background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", color: "#000" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ fontWeight: "600", fontSize: "0.9rem" }}>From Date:</label>
                  <input type="date" value={attendanceFromDate} onChange={(e) => setAttendanceFromDate(e.target.value)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ fontWeight: "600", fontSize: "0.9rem" }}>To Date:</label>
                  <input type="date" value={attendanceToDate} onChange={(e) => setAttendanceToDate(e.target.value)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                </div>
                <button className="admin-primary-btn" type="button" onClick={generateAttendanceReport} style={{ height: "auto", padding: "8px 16px" }}>Generate Report</button>
              </div>

              {attendanceGenerated ? renderAttendanceReportTable(attendanceFromDate, attendanceToDate, 1) : (
                <div style={{ padding: "40px", textAlign: "center", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0", color: "var(--text-muted)", fontSize: "1.1rem" }}>
                  Please select a valid From Date and To Date above, and click Generate Report.
                </div>
              )}
            </div>
          )}

          {quarterlySubView === "second-quarter" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <h2 style={{ margin: 0 }}>Second Quarter Attendance Report</h2>
                <div style={{ display: "flex", gap: "12px" }}>
                  {attendanceGenerated && (
                    <>
                      <button className="admin-primary-btn" type="button" onClick={() => saveAttendanceChanges(attendanceFromDate, attendanceToDate, 2)} disabled={isSavingProforma}>{isSavingProforma ? "Saving..." : "Save Changes"}</button>
                      <button className="admin-primary-btn" type="button" onClick={() => downloadExcel(attendanceFromDate, attendanceToDate, 2)}>Download Excel</button>
                      <button className="admin-primary-btn" type="button" onClick={() => handleDownloadPdf(attendanceFromDate, attendanceToDate, 2)}>Download PDF</button>
                      <button className="admin-primary-btn" type="button" onClick={() => handlePrint(attendanceFromDate, attendanceToDate, 2)}>Print</button>
                    </>
                  )}
                  <button className="admin-secondary-btn" type="button" onClick={() => setQuarterlySubView("attendance")}>Back</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px", background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", color: "#000" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ fontWeight: "600", fontSize: "0.9rem" }}>From Date:</label>
                  <input type="date" value={attendanceFromDate} onChange={(e) => setAttendanceFromDate(e.target.value)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ fontWeight: "600", fontSize: "0.9rem" }}>To Date:</label>
                  <input type="date" value={attendanceToDate} onChange={(e) => setAttendanceToDate(e.target.value)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                </div>
                <button className="admin-primary-btn" type="button" onClick={generateAttendanceReport} style={{ height: "auto", padding: "8px 16px" }}>Generate Report</button>
              </div>

              {attendanceGenerated ? renderAttendanceReportTable(attendanceFromDate, attendanceToDate, 2) : (
                <div style={{ padding: "40px", textAlign: "center", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0", color: "var(--text-muted)", fontSize: "1.1rem" }}>
                  Please select a valid From Date and To Date above, and click Generate Report.
                </div>
              )}
            </div>
          )}

          {quarterlySubView === "proforma" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <h2 style={{ margin: 0 }}>Proforma for Quarterly Report</h2>
                <div style={{ display: "flex", gap: "12px" }}>
                  {proformaGenerated && (
                    <>
                      <button className="admin-primary-btn" type="button" onClick={saveProformaChanges} disabled={isSavingProforma}>{isSavingProforma ? "Saving..." : "Save Changes"}</button>
                      <button className="admin-primary-btn" type="button" onClick={downloadProformaExcel}>Download Excel</button>
                      <button className="admin-primary-btn" type="button" onClick={handleProformaPrint}>Print</button>
                    </>
                  )}
                  <button className="admin-secondary-btn" type="button" onClick={() => setQuarterlySubView("menu")}>Back</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px", background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", color: "#000" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ fontWeight: "600", fontSize: "0.9rem" }}>From Date:</label>
                  <input type="date" value={proformaFromDate} onChange={(e) => setProformaFromDate(e.target.value)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ fontWeight: "600", fontSize: "0.9rem" }}>To Date:</label>
                  <input type="date" value={proformaToDate} onChange={(e) => setProformaToDate(e.target.value)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                </div>
                <button className="admin-primary-btn" type="button" onClick={generateProformaReport} style={{ height: "auto", padding: "8px 16px" }}>Generate Report</button>
              </div>

              {!proformaGenerated ? (
                <div style={{ padding: "40px", textAlign: "center", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0", color: "var(--text-muted)", fontSize: "1.1rem" }}>
                  Please select a valid From Date and To Date above, and click Generate Report.
                </div>
              ) : (
                <div style={{ background: "#fff", padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", color: "#000", fontFamily: "Arial, sans-serif", fontSize: "11px" }}>
                  <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "13px", marginBottom: "10px", textDecoration: "underline" }}>
                    PROFORMA FOR QUARTERLY REPORT IN R/O DRDO PAID INTERNSHIP SCHEME
                  </div>
                  <div style={{ textAlign: "right", fontSize: "10px", marginBottom: "10px" }}>
                    To be maintained at DG Cluster / Lab Level
                  </div>

                  <div style={{ marginBottom: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "11px" }}>Quarterly report for quarter ending:</h3>
                    <input
                      type="text"
                      value={proformaQuarterEnding}
                      onChange={(e) => setProformaQuarterEnding(e.target.value)}
                      placeholder="e.g. 30 Sept 2026"
                      style={{ border: "1px dashed #ccc", padding: "2px 4px", fontSize: "11px" }}
                    />
                  </div>

                  <h3 style={{ margin: "10px 0 5px 0", fontSize: "11px" }}>1. BRIEF OF REPORT:</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f2f2f2" }}>
                        <th colSpan="5" style={{ border: "1px solid #000" }}></th>
                        <th style={{ border: "1px solid #000", padding: "3px 4px", fontWeight: "bold", textAlign: "center" }}>DG Cluster</th>
                        <th colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px", fontWeight: "bold", textAlign: "center" }}>Lab / Estt</th>
                        <th colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px", fontWeight: "bold", textAlign: "center" }}>Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan="4" style={{ border: "1px solid #000", padding: "3px 4px" }}>A</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>Authorization of Intern:</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px", textAlign: "center" }}>Total students = {administration?.paidSeatLimit ?? 0}</td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px", textAlign: "center" }}>IRDE</td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}></td>
                      </tr>
                      <tr>
                        <td colSpan="4" style={{ border: "1px solid #000", padding: "3px 4px" }}>B</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          Held Strength of Intern / candidate:<br />
                          (i) Engaged in Projects<br />
                          (ii) Engaged in other R&D activity
                        </td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.B_dg_cluster || ""}
                            onChange={(e) => updateSection1("B_dg_cluster", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px", textAlign: "center" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.B_lab}
                            onChange={(e) => updateSection1("B_lab", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.B_remark}
                            onChange={(e) => updateSection1("B_remark", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan="4" style={{ border: "1px solid #000", padding: "3px 4px" }}>C</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          Vacant Intern / Candidate:<br />
                          (i) Under selection and likely to be engaged in Project / R&D activity<br />
                          (ii) Not under selection
                        </td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.C_dg_cluster || ""}
                            onChange={(e) => updateSection1("C_dg_cluster", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px", textAlign: "center" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.C_lab}
                            onChange={(e) => updateSection1("C_lab", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.C_remark}
                            onChange={(e) => updateSection1("C_remark", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan="4" style={{ border: "1px solid #000", padding: "3px 4px" }}>D</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>Internship awarded in the reporting period:</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.D_dg_cluster || ""}
                            onChange={(e) => updateSection1("D_dg_cluster", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px", textAlign: "center" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.D_lab}
                            onChange={(e) => updateSection1("D_lab", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.D_remark}
                            onChange={(e) => updateSection1("D_remark", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan="4" style={{ border: "1px solid #000", padding: "3px 4px" }}>E</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>Intern / candidate resigned / terminated in the reporting period:</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.E_dg_cluster || ""}
                            onChange={(e) => updateSection1("E_dg_cluster", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px", textAlign: "center" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.E_lab}
                            onChange={(e) => updateSection1("E_lab", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.E_remark}
                            onChange={(e) => updateSection1("E_remark", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan="4" style={{ border: "1px solid #000", padding: "3px 4px" }}>F</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>Details of achievement:</td>
                        <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.F_dg_cluster || ""}
                            onChange={(e) => updateSection1("F_dg_cluster", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px", textAlign: "center" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.F_lab}
                            onChange={(e) => updateSection1("F_lab", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                        <td colSpan="2" style={{ border: "1px solid #000", padding: "3px 4px" }}>
                          <input
                            type="text"
                            value={proformaSection1.F_remark}
                            onChange={(e) => updateSection1("F_remark", e.target.value)}
                            style={{ border: "1px dashed #ccc", width: "100%", padding: "2px", boxSizing: "border-box", fontSize: "11px" }}
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <h3 style={{ margin: "20px 0 5px 0", fontSize: "11px" }}>2. DETAILS IN R/O EACH INTERN:</h3>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f2f2f2" }}>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>S.No</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Name of Intern</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Discipline</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Gender</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Date of Birth</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Date of joining the Lab</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Name of Project</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Title of assignment</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Name of the Supervisor</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Name & PDC of the Project in which working</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Achievements</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Date of Completion of internship</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Date of Resignation, if applicable</th>
                          <th style={{ border: "1px solid #000", padding: "3px 4px" }}>Remarks</th>
                        </tr>
                        <tr style={{ textAlign: "center", backgroundColor: "#fafafa" }}>
                          <td style={{ border: "1px solid #000" }}></td>
                          <td style={{ border: "1px solid #000" }}>(1)</td>
                          <td style={{ border: "1px solid #000" }}>(2)</td>
                          <td style={{ border: "1px solid #000" }}>(3)</td>
                          <td style={{ border: "1px solid #000" }}>(4)</td>
                          <td style={{ border: "1px solid #000" }}>(5)</td>
                          <td style={{ border: "1px solid #000" }}>(6)</td>
                          <td style={{ border: "1px solid #000" }}>(7)</td>
                          <td style={{ border: "1px solid #000" }}>(8)</td>
                          <td style={{ border: "1px solid #000" }}>(9)</td>
                          <td style={{ border: "1px solid #000" }}>(10)</td>
                          <td style={{ border: "1px solid #000" }}>(11)</td>
                          <td style={{ border: "1px solid #000" }}>(12)</td>
                          <td style={{ border: "1px solid #000" }}>(13)</td>
                        </tr>
                      </thead>
                      <tbody>
                        {proformaStudents.length > 0 ? (
                          proformaStudents.map((s, idx) => (
                            <tr key={s._id}>
                              <td style={{ border: "1px solid #000", padding: "3px 4px", textAlign: "center" }}>{idx + 1}</td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.name} onChange={(e) => updateStudentRow(idx, "name", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.discipline} onChange={(e) => updateStudentRow(idx, "discipline", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.gender} onChange={(e) => updateStudentRow(idx, "gender", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.dob} onChange={(e) => updateStudentRow(idx, "dob", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.joiningDate} onChange={(e) => updateStudentRow(idx, "joiningDate", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.projectName} onChange={(e) => updateStudentRow(idx, "projectName", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.designationTitle} onChange={(e) => updateStudentRow(idx, "designationTitle", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.supervisorName} onChange={(e) => updateStudentRow(idx, "supervisorName", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.projectNameAndPdc} onChange={(e) => updateStudentRow(idx, "projectNameAndPdc", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.achievements} onChange={(e) => updateStudentRow(idx, "achievements", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.completionDate} onChange={(e) => updateStudentRow(idx, "completionDate", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.resignationDate} onChange={(e) => updateStudentRow(idx, "resignationDate", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                              <td style={{ border: "1px solid #000", padding: "3px 4px" }}>
                                <input type="text" value={s.remarks} onChange={(e) => updateStudentRow(idx, "remarks", e.target.value)} style={{ border: "1px dashed #ccc", width: "100%", fontSize: "11px", boxSizing: "border-box" }} />
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="14" style={{ textAlign: "center", padding: "12px", border: "1px solid #000" }}>No approved Paid student records found.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Student Management (Split view) */}
      {/* VIEW 2: Student Management (Default List page) */}
      {currentView === "student-management" && (
        <div className="admin-split-layout" style={{ width: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
            <h2 style={{ margin: 0 }}>Registered Students</h2>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                className="admin-secondary-btn"
                type="button"
                onClick={async () => {
                  try {
                    setIsExportingApplications(true);
                    await exportApplicationsExcel();
                  } catch (err) {
                    console.error("Export applications failed:", err);
                    alert(err.message || "Failed to export applications.");
                  } finally {
                    setIsExportingApplications(false);
                  }
                }}
                disabled={isExportingApplications}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 16px" }}
              >
                {isExportingApplications ? "Exporting..." : "📊 Export to Excel"}
              </button>
              <button
                className="admin-primary-btn"
                type="button"
                onClick={() => {
                  setShowTypeModal(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 16px" }}
              >
                + New Student
              </button>
            </div>
          </div>

          {/* Dynamic Summary Cards */}
          <section className="admin-summary-grid" style={{ marginBottom: "20px" }}>
            <div className="admin-summary-card">
              <span>Total Students</span>
              <strong>{internshipStudents.length}</strong>
            </div>
            <div className="admin-summary-card">
              <span>Approved Students</span>
              <strong>{internshipStudents.filter(s => s.status === "Approved").length}</strong>
            </div>
            <div className="admin-summary-card">
              <span>Pending Students</span>
              <strong>{internshipStudents.filter(s => s.status === "Pending" || !s.status).length}</strong>
            </div>
            <div className="admin-summary-card">
              <span>Rejected Students</span>
              <strong>{internshipStudents.filter(s => s.status === "Rejected").length}</strong>
            </div>
          </section>

          {/* Local Search and Filters */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            <input
              type="text"
              placeholder="Search by Name, Reference ID, Email, Phone, College Name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: "1 1 100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color, #cbd5e1)" }}
            />
            <select
              value={internshipTypeFilter}
              onChange={(e) => setInternshipTypeFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color, #cbd5e1)", background: "#fff", fontWeight: "600" }}
            >
              <option value="all">All Students</option>
              <option value="paid">Paid Internship</option>
              <option value="unpaid">Unpaid Internship</option>
            </select>
            <button className="admin-secondary-btn" type="button" onClick={() => setManagementFieldsOpen(true)}>Select Fields</button>
            <button className="admin-danger-btn" type="button" onClick={toggleDeleteMode}>{deleteMode ? "Cancel Delete" : "Delete Entry"}</button>
            {deleteMode && (
              <button className="admin-danger-btn" type="button" onClick={deleteSelected}>
                Delete Selected
              </button>
            )}
          </div>

          {/* Counts */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", fontSize: "0.9rem", color: "var(--text-muted)" }}>
            <span>Total Students : <strong>{internshipStudents.length}</strong></span>
            <span>Showing : <strong>{sortedStudents.length}</strong></span>
          </div>

          {/* Sorting List Table */}
          <div className="admin-table-wrap" style={{ overflowX: "auto" }}>
            <table className="admin-table student-management-table" style={{ tableLayout: "auto", width: "max-content", minWidth: "1500px" }}>
              <thead>
                <tr>
                  {deleteMode && <th>Select</th>}
                  <th hidden={!managementFields.includes("serial")}>S.No.</th>
                  <th hidden={!managementFields.includes("name")} style={{ cursor: "pointer", width: "25%", whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => handleSortClick("name")}>
                    Name {sort.sortBy === "name" && (sort.sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th hidden={!managementFields.includes("referenceId")}>Reference ID</th>
                  <th hidden={!managementFields.includes("course")} style={{ cursor: "pointer", width: "22%", whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => handleSortClick("course")}>
                    Course {sort.sortBy === "course" && (sort.sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th hidden={!managementFields.includes("branch")} style={{ cursor: "pointer", width: "25%", whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => handleSortClick("branch")}>
                    Branch {sort.sortBy === "branch" && (sort.sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th hidden={!managementFields.includes("year")} style={{ cursor: "pointer", width: "10%", whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => handleSortClick("year")}>
                    Year {sort.sortBy === "year" && (sort.sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th hidden={!managementFields.includes("collegeName")} style={{ cursor: "pointer", width: "20%", whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => handleSortClick("collegeName")}>
                    College Name {sort.sortBy === "collegeName" && (sort.sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th hidden={!managementFields.includes("location")}>College Location</th>
                  <th hidden={!managementFields.includes("email")}>Email</th>
                  <th hidden={!managementFields.includes("phone")}>Phone</th>
                  <th hidden={!managementFields.includes("status")} style={{ cursor: "pointer", width: "10%", whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => handleSortClick("status")}>
                    Status {sort.sortBy === "status" && (sort.sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th style={{ width: "8%" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedStudents.map((student) => (
                  <tr
                    key={student._id}
                    style={{ cursor: "pointer" }}
                    onClick={() => handleSelectStudentWithCheck(student._id)}
                  >
                    {deleteMode && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(student._id)}
                          onChange={(e) => toggleSelected(student._id, e.target.checked)}
                          aria-label={`Select ${student.name}`}
                        />
                      </td>
                    )}
                    <td hidden={!managementFields.includes("serial")}>{sortedStudents.indexOf(student) + 1}</td>
                    <td hidden={!managementFields.includes("name")} style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{student.name}</td>
                    <td hidden={!managementFields.includes("referenceId")}>{student.referenceId || "-"}</td>
                    <td hidden={!managementFields.includes("course")} style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{student.course}</td>
                    <td hidden={!managementFields.includes("branch")} style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{student.branch}</td>
                    <td hidden={!managementFields.includes("year")} style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{student.year}</td>
                    <td hidden={!managementFields.includes("collegeName")} style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{student.collegeName || "-"}</td>
                    <td hidden={!managementFields.includes("location")}>{student.location || "-"}</td>
                    <td hidden={!managementFields.includes("email")}>{student.email || "-"}</td>
                    <td hidden={!managementFields.includes("phone")}>{student.phone || "-"}</td>
                    <td hidden={!managementFields.includes("status")} style={{ whiteSpace: "normal", wordBreak: "break-word", verticalAlign: "middle" }}
                      onClick={e => e.stopPropagation()}>
                      <select
                        value={student.status}
                        disabled={statusUpdating === student._id}
                        onChange={(e) => handleStatusDropdownChange(e, student)}
                        style={{
                          ...STATUS_COLORS[student.status],
                          border: `1px solid ${STATUS_COLORS[student.status]?.border || "#cbd5e1"}`,
                          borderRadius: "6px",
                          padding: "3px 6px",
                          fontSize: "0.8rem",
                          fontWeight: "600",
                          cursor: statusUpdating === student._id ? "wait" : "pointer",
                          width: "100%",
                          appearance: "auto",
                        }}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="admin-secondary-btn admin-table-action"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectStudentWithCheck(student._id);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedStudents.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                      No registrations found matching the filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {managementFieldsOpen && <div className="reports-dialog-backdrop" role="presentation"><section className="reports-dialog" role="dialog" aria-modal="true" aria-label="Select student table fields"><h2>Select Fields</h2><div className="reports-field-list">{MANAGEMENT_COLUMNS.map(([key, label]) => <label key={key}><input type="checkbox" checked={managementFields.includes(key)} onChange={() => toggleManagementField(key)} /> {label}</label>)}</div><div className="reports-dialog-actions"><button className="admin-secondary-btn" type="button" onClick={() => setManagementFields(MANAGEMENT_COLUMNS.map(([key]) => key))}>Select All</button><button className="admin-primary-btn" type="button" onClick={() => setManagementFieldsOpen(false)}>Done</button></div></section></div>}

      {/* VIEW 2b: Student Registration (100% width) */}
      {currentView === "student-management-new" && (
        <div style={{ width: "100%", padding: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <h2 style={{ margin: 0 }}>New Student Registration</h2>
            <button
              className="admin-secondary-btn"
              type="button"
              onClick={() => {
                window.history.pushState({}, "", "/admin/student-management");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              style={{ height: "36px", padding: "0 16px", minWidth: "220px" }}
            >
              Back to Student Management
            </button>
          </div>
          <StudentForm
            embedded={true}
            onClose={handleCloseRegistrationForm}
            defaultInternshipType={newStudentType}
          />
        </div>
      )}

      {/* VIEW 2c: Student Details (100% width) */}
      {currentView === "student-management-details" && (
        <div style={{ width: "100%" }}>
          <StudentDetails
            id={window.location.pathname.split("/").pop()}
            onClose={() => {
              window.history.pushState({}, "", "/admin/student-management");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            inSplitView={false}
            source="management"
            onDirtyChange={setIsDetailsDirty}
            saveTrigger={saveTrigger}
            onSaveSuccess={handleSaveSuccess}
            onSaveFailure={handleSaveFailure}
            onDeleteSuccess={handleDeleteSuccess}
          />
        </div>
      )}

      {/* VIEW 3: Approved Students View (Original application table) */}
      {currentView === "approved-students" && (
        <>
          <DashboardCards summary={{ approvedStudents: students.length }} />

          <section className="admin-panel" style={{ marginTop: "24px" }}>
            <div className="admin-panel__header">
              <SearchBar value={search} onChange={setSearch} />
              <SortControls sort={sort} onChange={setSort} />
            </div>

            <div className="admin-actions-row">
              {offerLetterMode ? (
                <>
                  <button
                    className="admin-primary-btn admin-btn-small"
                    type="button"
                    disabled={offerLetterBusy || !offerLetterIds.length}
                    onClick={() => startOfferLetterWorkflow("download")}
                  >
                    Download Offer Letters
                  </button>
                  <button
                    className="admin-secondary-btn admin-btn-small"
                    type="button"
                    disabled={offerLetterBusy || !offerLetterIds.length}
                    onClick={() => startOfferLetterWorkflow("print")}
                  >
                    Print Offer Letters
                  </button>
                  <button
                    className="admin-secondary-btn admin-btn-small"
                    type="button"
                    onClick={cancelOfferLetterWorkflow}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <select
                    value={filters.internshipType || ""}
                    onChange={(e) => {
                      setFilters((prev) => ({ ...prev, internshipType: e.target.value }));
                    }}
                    style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color, #cbd5e1)", background: "#fff", fontWeight: "600" }}
                  >
                    <option value="">All Students</option>
                    <option value="Paid">Paid Internship</option>
                    <option value="Unpaid">Unpaid Internship</option>
                  </select>
                  <button className="admin-secondary-btn" type="button" onClick={() => openDocumentModal("certificate")}>
                    Generate Certificate
                  </button>
                  <button className="admin-secondary-btn" type="button" onClick={() => openDocumentModal("ism")}>
                    Generate ISM
                  </button>
                  <button className="admin-secondary-btn" type="button" onClick={() => { setOfferLetterMode(true); setOfferLetterIds([]); }}>
                    Generate Offer Letter
                  </button>
                  <button
                    className="admin-danger-btn"
                    type="button"
                    onClick={toggleDeleteMode}
                  >
                    {deleteMode ? "Cancel Delete" : "Delete Entry"}
                  </button>
                  {deleteMode && (
                    <button className="admin-danger-btn" type="button" onClick={deleteSelected}>
                      Delete Selected
                    </button>
                  )}
                </>
              )}
            </div>

            <FilterBar
              filters={filters}
              onChange={setFilters}
              students={allStudents}
            />

            {error && <p className="admin-error">{error}</p>}
            {loading ? (
              <div className="admin-loading">Loading applications...</div>
            ) : (
              <StudentTable
                deleteMode={deleteMode}
                onSelect={toggleSelected}
                onView={openStudent}
                selectedIds={selectedIds}
                students={displayedStudents}
                onStatusChange={handleStatusChange}
                certificateDownloadedIds={certificateDownloadedIds}
                offerLetterMode={offerLetterMode}
                offerLetterIds={offerLetterIds}
                onOfferLetterSelect={(ids, checked) => setOfferLetterIds((current) => checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)))}
                sort={sort}
                onSortChange={setSort}
              />
            )}
          </section>

          {documentModal && (() => {
            const currentDocument = documentQueue[documentIndex];
            const selectionOpen = documentQueue.length === 0;
            const allDocumentStudentsSelected = documentStudents.length > 0 && documentStudents.every((student) => documentSelectedIds.includes(student._id));
            const moveNext = () => {
              if (certificatePreview?.url) URL.revokeObjectURL(certificatePreview.url);
              setCertificatePreview(null);
              setSignatureEditorOpen(false);
              setSignatureError("");
              if (documentIndex + 1 >= documentQueue.length) closeDocumentModal();
              else setDocumentIndex((index) => index + 1);
            };
            const printDocument = () => {
              const frame = document.getElementById(documentModal === "certificate" ? "dashboard-certificate-preview" : "dashboard-ism-preview");
              if (documentModal === "ism" && frame?.contentDocument && !frame.contentDocument.getElementById("ism-print-fit")) {
                const style = frame.contentDocument.createElement("style");
                style.id = "ism-print-fit";
                style.textContent = "@media print { .document-container { min-height: 297mm !important; } .cc-section { margin-bottom: 0 !important; } .system-footer { position: absolute !important; left: 20mm !important; right: 20mm !important; bottom: 10mm !important; width: auto !important; margin: 0 !important; } }";
                frame.contentDocument.head.appendChild(style);
              }
              frame?.contentWindow?.print();
            };
            return <div className="certificate-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Generate ${documentModal === "ism" ? "ISM" : "Certificate"}`}>
              <section className="certificate-modal certificate-modal--wide">
                {selectionOpen ? (documentOutputChoice ? <>
                  <h2>Choose Certificate Output</h2>
                  <p className="admin-muted">Select how the certificate should be generated.</p>
                  <div className="admin-actions-row"><button className="admin-primary-btn" type="button" onClick={() => startDocumentGeneration("full")}>Generate Certificate</button><button className="admin-secondary-btn" type="button" onClick={() => startDocumentGeneration("template")}>Print on Template</button></div>
                </> : <>
                  <h2>Generate {documentModal === "ism" ? "ISM" : "Certificate"}</h2>
                  <p className="admin-muted">Select approved students, then generate {documentModal === "ism" ? "ISM documents grouped by division" : "one certificate for each student"}.</p>
                  <div className="admin-actions-row"><label className="admin-field"><span>Search Students</span><input type="search" placeholder="Student name or college name" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} /></label><button className="admin-secondary-btn" type="button" onClick={selectAllDocumentStudents}>Select All</button><button className="admin-secondary-btn" type="button" onClick={() => setDocumentSelectedIds([])}>Deselect All</button></div>
                  <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th><input type="checkbox" checked={allDocumentStudentsSelected} onChange={(event) => event.target.checked ? selectAllDocumentStudents() : setDocumentSelectedIds([])} /></th><th>Student Name</th><th>Reference ID</th><th>Division</th><th>College Name</th><th>Branch</th><th>Course</th></tr></thead><tbody>{documentStudents.map((student) => {
                    const isCertificate = documentModal === "certificate";
                    const isDownloaded = isCertificate
                      ? (certificateDownloadedIds.includes(student._id) || student.certificateGenerated)
                      : (ismDownloadedIds.includes(student._id) || student.gyapanGenerated);

                    const rowStyle = isDownloaded
                      ? { backgroundColor: "#a7f3d0", color: "#064e3b", fontWeight: "600" }
                      : {};

                    return <tr key={student._id} style={rowStyle}><td><input type="checkbox" checked={documentSelectedIds.includes(student._id)} onChange={(event) => toggleDocumentStudent(student._id, event.target.checked)} aria-label={`Select ${student.name}`} /></td><td>{student.name}</td><td>{student.referenceId || "-"}</td><td>{student.trainingManagement?.division || "-"}</td><td>{student.trainingManagement?.collegeName || student.collegeName || "-"}</td><td>{student.trainingManagement?.branch || student.branch || "-"}</td><td>{student.trainingManagement?.courseName || student.course || "-"}</td></tr>;
                  })}</tbody></table>{!documentStudents.length && <div className="admin-empty-state">No approved students found.</div>}</div>
                  {documentError && <p className="admin-error">{documentError}</p>}
                  <div className="admin-actions-row"><button className="admin-primary-btn" type="button" disabled={documentBusy || !documentSelectedIds.length} onClick={() => startDocumentGeneration()}>{documentBusy ? "Generating..." : "Generate"}</button><button className="admin-secondary-btn" type="button" disabled={documentBusy} onClick={closeDocumentModal}>Cancel</button></div>
                </>) : <>
                  <h2>{documentModal === "ism" ? `ISM ${documentIndex + 1} of ${documentQueue.length}` : `Certificate ${documentIndex + 1} of ${documentQueue.length}`}</h2>
                  <p>{documentModal === "ism" ? `Division: ${currentDocument.gyapan.studentRows?.[0]?.division || "-"}` : <>Student: <strong>{currentDocument.student?.name}</strong></>}</p>
                  {documentModal === "ism" ? (
                    <iframe id="dashboard-ism-preview" title="ISM preview" className="certificate-preview-frame" srcDoc={currentDocument.html || "<p>Preview unavailable.</p>"} />
                  ) : certificatePreview ? (
                    <iframe id="dashboard-certificate-preview" title="Certificate preview" className="certificate-preview-frame" src={certificatePreview.url} />
                  ) : (
                    <p className="admin-muted">Prepare this certificate to preview, print, or download it.</p>
                  )}
                  {documentError && <p className="admin-error">{documentError}</p>}
                  <div className="admin-actions-row">{documentModal === "certificate" && !certificatePreview ? <button className="admin-primary-btn" type="button" disabled={documentBusy} onClick={prepareCertificate}>{documentBusy ? "Generating..." : "Preview Certificate"}</button> : <><button className="admin-secondary-btn" type="button" onClick={printDocument}>Print</button>{documentModal === "ism" ? <button className="admin-primary-btn" type="button" disabled={documentBusy} onClick={downloadIsm}>{documentBusy ? "Preparing..." : "Download"} </button> : <><button className="admin-primary-btn" type="button" onClick={downloadCertificate}>Download</button><button className="admin-secondary-btn" type="button" disabled={documentBusy} onClick={openSignatureEditor}>Edit</button></>}<button className="admin-secondary-btn" type="button" onClick={moveNext}>{documentIndex + 1 === documentQueue.length ? "Finish" : "Next"}</button></>}<button className="admin-secondary-btn" type="button" disabled={documentBusy} onClick={closeDocumentModal}>Close</button></div>
                </>}
              </section>
            </div>;
          })()}
        </>
      )}

      {offerLetterQueue.length > 0 && (() => {
        const student = students.find((item) => item._id === offerLetterQueue[0]);
        const verb = offerLetterAction === "print" ? "Print" : "Download";
        return <div className="administration-dialog-backdrop" role="presentation"><section className="administration-dialog" role="dialog" aria-modal="true" aria-label={`${verb} offer letter`}><h2>{verb} Offer Letter</h2><p>{verb} Offer Letter for <strong>{student?.name || "this student"}</strong>?</p><div className="administration-dialog__actions"><button className="admin-primary-btn" type="button" disabled={offerLetterBusy} onClick={() => processOfferLetter(verb.toLowerCase())}>{offerLetterBusy ? "Generating..." : verb}</button><button className="admin-secondary-btn" type="button" disabled={offerLetterBusy} onClick={() => processOfferLetter("skip")}>Skip</button><button className="admin-danger-btn" type="button" disabled={offerLetterBusy} onClick={stopOfferLetterWorkflow}>Cancel Remaining</button></div></section></div>;
      })()}

      {/* VIEW 4: Administration Module Groups */}
      {currentView === "administration" && (
        <div style={{ marginTop: "24px" }}>
          <h2 style={{ marginBottom: "20px" }}>System Administration Modules</h2>
          <div className="admin-dashboard-home-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
            <div className="admin-summary-card admin-summary-card--interactive" onClick={openCollegeManagement} style={{ cursor: "pointer", padding: "28px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
              <h3 style={{ marginTop: 0, color: "var(--primary)" }}>🏫 College Management</h3>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>Register, edit, import, or remove registered college listings.</p>
            </div>
            {isMainAdmin && (
              <div className="admin-summary-card admin-summary-card--interactive" onClick={openProfile} style={{ cursor: "pointer", padding: "28px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }}>
                <h3>👤 Admin Profile</h3>
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>Manage sub-user passwords, configure login profiles, and access audit logs.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unsaved Changes Premium Modal */}
      {showUnsavedModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: "#fff",
            padding: "32px",
            borderRadius: "12px",
            width: "420px",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}>
            <h3 style={{ marginTop: 0, fontSize: "1.4rem", color: "#e11d48", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              ⚠️ Unsaved Changes
            </h3>
            <p style={{ margin: "16px 0", color: "#475569", lineHeight: "1.5" }}>
              You have unsaved changes. Do you want to Save, Discard, or Cancel?
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "24px" }}>
              <button
                className="admin-primary-btn"
                style={{ backgroundColor: "var(--primary)" }}
                onClick={() => {
                  setSaveTrigger(prev => prev + 1);
                }}
              >
                Save
              </button>
              <button
                className="admin-danger-btn"
                style={{ backgroundColor: "#e11d48", color: "#fff" }}
                onClick={() => {
                  setIsDetailsDirty(false);
                  executePendingAction();
                }}
              >
                Discard
              </button>
              <button
                className="admin-secondary-btn"
                onClick={() => {
                  setPendingAction(null);
                  setShowUnsavedModal(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Change Confirmation Modal (Student Management only) */}
      {statusConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
          <div style={{ background: "#fff", borderRadius: "12px", padding: "32px", maxWidth: "420px", width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0, fontSize: "1.2rem", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>✏️ Confirm Status Change</h3>
            <p style={{ margin: "16px 0", color: "#475569", lineHeight: "1.6" }}>
              Are you sure you want to change the status from{" "}
              <strong style={{ color: STATUS_COLORS[statusConfirm.oldStatus]?.color }}>{statusConfirm.oldStatus}</strong>
              {" "}to{" "}
              <strong style={{ color: STATUS_COLORS[statusConfirm.newStatus]?.color }}>{statusConfirm.newStatus}</strong>?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <button
                className="admin-secondary-btn"
                onClick={() => setStatusConfirm(null)}
              >
                No
              </button>
              <button
                className="admin-primary-btn"
                onClick={confirmStatusChange}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecoverySetup && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          backdropFilter: "blur(6px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 99999,
        }}>
          <form onSubmit={handleRecoverySetupSubmit} style={{
            backgroundColor: "#fff",
            padding: "36px",
            borderRadius: "16px",
            width: "450px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            display: "flex",
            flexDirection: "column",
            gap: "20px"
          }}>
            <h2 style={{ margin: 0, fontSize: "1.6rem", color: "var(--primary)" }}>🔒 Security Setup</h2>
            <p style={{ margin: 0, color: "#475569", fontSize: "0.95rem", lineHeight: "1.5" }}>
              Please set up your password recovery information. This is a one-time configuration and will be used to recover your account if you forget your password.
            </p>
            {recoveryError && <p className="admin-error" style={{ margin: 0 }}>{recoveryError}</p>}

            <label className="admin-field">
              <span>Secret Question</span>
              <input
                type="text"
                placeholder="e.g. What was the name of your first school?"
                value={recoveryForm.secretQuestion}
                onChange={(e) => setRecoveryForm({ ...recoveryForm, secretQuestion: e.target.value })}
                required
              />
            </label>

            <label className="admin-field">
              <span>Secret Answer</span>
              <input
                type="password"
                placeholder="Enter answer"
                value={recoveryForm.secretAnswer}
                onChange={(e) => setRecoveryForm({ ...recoveryForm, secretAnswer: e.target.value })}
                required
              />
            </label>

            <button className="admin-primary-btn" type="submit" disabled={recoveryBusy} style={{ marginTop: "8px", height: "40px" }}>
              {recoveryBusy ? "Saving..." : "Save Recovery Info"}
            </button>
          </form>
        </div>
      )}
      {showTypeModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: "#fff",
            padding: "32px",
            borderRadius: "12px",
            width: "420px",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "16px"
          }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", color: "var(--primary)" }}>Add New Student</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Select Internship Type</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
              <button
                className="admin-primary-btn"
                style={{ width: "100%", height: "40px", justifyContent: "center" }}
                onClick={() => {
                  setNewStudentType("Unpaid");
                  setShowTypeModal(false);
                  window.history.pushState({}, "", "/admin/student-management/new");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
              >
                Add Unpaid Student
              </button>
              <button
                className="admin-primary-btn"
                style={{ width: "100%", height: "40px", justifyContent: "center", backgroundColor: "var(--primary)" }}
                onClick={() => {
                  setNewStudentType("Paid");
                  setShowTypeModal(false);
                  window.history.pushState({}, "", "/admin/student-management/new");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
              >
                Add Paid Student
              </button>
              <button
                className="admin-secondary-btn"
                style={{ width: "100%", height: "40px", justifyContent: "center" }}
                onClick={() => {
                  setShowTypeModal(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {signatureEditorOpen && (
        <div className="certificate-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit authorized officer">
          <form className="certificate-modal" onSubmit={(event) => { event.preventDefault(); saveSignature(); }}>
            <h2>Edit Authorized Officer</h2>
            <label className="admin-field">
              <span>Name</span>
              <input autoFocus value={signatureDraft.name} onChange={(event) => setSignatureDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="admin-field">
              <span>Designation</span>
              <input value={signatureDraft.designation} onChange={(event) => setSignatureDraft((current) => ({ ...current, designation: event.target.value }))} />
            </label>
            {signatureError && <p className="admin-error" style={{ color: "red" }}>{signatureError}</p>}
            <div className="admin-actions-row">
              <button className="admin-primary-btn" type="submit">Save</button>
              <button className="admin-secondary-btn" type="button" onClick={() => setSignatureEditorOpen(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

export default AdminDashboard;
