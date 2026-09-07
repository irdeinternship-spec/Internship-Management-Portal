import "../styles/landing.css";

function navigateTo(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Landing({ isPaid = false }) {
  const portalCards = [
    {
      title: "Apply for Internship",
      description: [
        "Submit a New Application",
        "Fill the Application Form",
        "Upload Required Documents",
      ],
      buttonText: "Apply for Internship",
      path: isPaid ? "/paid-internship/register" : "/student",
    },
    {
      title: "Student Login",
      description: [
        "Use Application Email",
        "Enter Application ID",
        "Check Application Status and Documents",
      ],
      buttonText: "Student Login",
      path: isPaid ? "/paid-internship/login" : "/student/login",
    },
  ];

  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero__identity">
          <img src="/drdo-logo.png" alt="DRDO" className="landing-logo" />
          <div>
            <p className="landing-eyebrow">Government of India</p>
            <h1>
              Defence Research and Development Organisation (DRDO) Internship Management Portal
            </h1>
            {isPaid && (
              <p style={{ fontSize: "28px", fontWeight: "700", color: "var(--primary)", marginTop: "12px", textAlign: "left" }}>
                Under Paid Internship Program
              </p>
            )}
          </div>
        </div>

        <p className="landing-welcome">
          Welcome to the official internship management portal. Select the
          relevant portal below to continue with an internship application or
          administrative review.
        </p>
      </section>

      <section className="landing-card-grid" aria-label="Portal options">
        {portalCards.map((card) => (
          <article className="landing-card" key={card.title}>
            <div>
              <h2>{card.title}</h2>
              <ul>
                {card.description.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <button
              className="landing-card__button"
              type="button"
              onClick={() => navigateTo(card.path)}
            >
              {card.buttonText}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}

export default Landing;
