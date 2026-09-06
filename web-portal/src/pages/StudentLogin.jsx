import { useState } from "react";
import { loginStudent } from "../services/studentService";
import { setStudentSession } from "../services/studentSession";
import "../styles/form.css";

function StudentLogin() {
  const [form, setForm] = useState({ email: "", referenceId: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "referenceId" ? value.toUpperCase() : value,
    }));
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const credentials = {
        email: form.email.trim().toLowerCase(),
        referenceId: form.referenceId.trim().toUpperCase(),
      };
      const response = await loginStudent(credentials);
      setStudentSession(response.token);
      window.history.pushState({}, "", "/student/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="portal-shell">
      <section className="portal-card portal-card--narrow">
        <header className="portal-header">
          <img src="/drdo-logo.png" alt="DRDO logo" className="portal-logo" />
          <div>
            <p className="portal-eyebrow">Student Portal</p>
            <h1>Student Login</h1>
          </div>
        </header>

        <form className="student-form" onSubmit={handleSubmit}>
          <label className="input-field">
            <span>Registered Email Address</span>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              required
            />
          </label>
          <label className="input-field">
            <span>Reference ID</span>
            <input
              name="referenceId"
              value={form.referenceId}
              onChange={handleChange}
              required
            />
          </label>
          {error && <p className="submit-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default StudentLogin;
